import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { apiUrl, getSessionToken, resetSessionToken } from "../lib/api";
import { loadBrowserProfile } from "../lib/profile";
import {
  clearActiveRoomSession,
  loadActiveRoomSession,
  saveActiveRoomSession,
  updateActiveRoomName,
  updateActiveRoomSnapshot,
} from "../lib/roomSession";
import type {
  Ack,
  ChatMessage,
  ChatReply,
  PlaybackCommand,
  RoomResumeResult,
  RoomSnapshot,
  SharedProfile,
} from "../types";

interface PartyState {
  socket: Socket | null;
  connected: boolean;
  connecting: boolean;
  sessionId: string | null;
  snapshot: RoomSnapshot | null;
  messages: ChatMessage[];
  error: string | null;
  notice: string | null;
  bootstrapping: boolean;
  rejoining: boolean;
}

const initialState: PartyState = {
  socket: null,
  connected: false,
  connecting: true,
  sessionId: null,
  snapshot: null,
  messages: [],
  error: null,
  notice: null,
  bootstrapping: true,
  rejoining: false,
};

function emitWithAck<T>(
  socket: Socket,
  event: string,
  payload?: unknown,
  timeoutMs = 10_000,
) {
  return new Promise<T>((resolve, reject) => {
    if (!socket.connected) {
      reject(new Error("Chưa kết nối với máy chủ."));
      return;
    }
    socket.timeout(timeoutMs).emit(event, payload ?? {}, (error: Error | null, ack?: Ack<T>) => {
      if (error) {
        reject(new Error("Máy chủ không phản hồi. Hãy thử lại."));
        return;
      }
      if (!ack) {
        reject(new Error("Máy chủ trả về dữ liệu không hợp lệ."));
        return;
      }
      if (!ack.ok) {
        reject(new Error(ack.error.message));
        return;
      }
      resolve(ack.data);
    });
  });
}

export function useWatchParty(expectedRoomCode = "") {
  const [state, setState] = useState(initialState);
  const socketRef = useRef<Socket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const expectedRoomCodeRef = useRef(expectedRoomCode.toUpperCase());
  const lastResumedSocketIdRef = useRef<string | null>(null);

  useEffect(() => {
    expectedRoomCodeRef.current = expectedRoomCode.toUpperCase();
  }, [expectedRoomCode]);

  useEffect(() => {
    if (!state.notice) return;
    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, notice: null }));
    }, 6_000);
    return () => window.clearTimeout(timer);
  }, [state.notice]);

  useEffect(() => {
    let cancelled = false;
    void getSessionToken()
      .then((token) => {
        if (cancelled) return;
        const socket = io(apiUrl(), {
          auth: { token },
          transports: ["websocket", "polling"],
          autoConnect: false,
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1_000,
          reconnectionDelayMax: 4_000,
          timeout: 20_000,
        });
        socketRef.current = socket;
        setState((current) => ({ ...current, socket }));

        socket.on("connect", () =>
          setState((current) => ({ ...current, connected: true, connecting: false, error: null })),
        );
        socket.on("disconnect", (reason) =>
          setState((current) => ({
            ...current,
            connected: false,
            connecting: socket.active,
            rejoining: Boolean(current.snapshot && socket.active),
            error: reason === "io server disconnect" ? "Phiên kết nối đã đóng." : current.error,
          })),
        );
        socket.on("connect_error", (error) =>
          setState((current) => ({
            ...current,
            connecting: socket.active,
            bootstrapping: current.snapshot ? false : current.bootstrapping,
            error: current.snapshot
              ? "Mất kết nối. Watchroom đang tự vào lại phòng…"
              : error.message.includes("xhr poll error")
                ? "Máy chủ đang khởi động, vui lòng chờ…"
                : "Đang kết nối lại với máy chủ…",
          })),
        );
        socket.on("session:ready", ({ sessionId }: { sessionId: string }) => {
          sessionIdRef.current = sessionId;
          setState((current) => ({ ...current, sessionId }));
          const expectedCode = expectedRoomCodeRef.current;
          const activeRoom = expectedCode ? loadActiveRoomSession(expectedCode) : null;
          if (!activeRoom || lastResumedSocketIdRef.current === socket.id) {
            setState((current) => ({ ...current, bootstrapping: false, rejoining: false }));
            return;
          }

          lastResumedSocketIdRef.current = socket.id ?? null;
          setState((current) => ({ ...current, bootstrapping: false, rejoining: true, error: null }));
          const profile = loadBrowserProfile();
          void emitWithAck<RoomResumeResult>(socket, "room:resume", {
            roomCode: activeRoom.roomCode,
            name: activeRoom.name,
            avatarUrl: profile.avatarUrl,
            recovery: activeRoom.recovery,
          }, 60_000)
            .then(({ snapshot, recovered }) => {
              if (cancelled) return;
              updateActiveRoomSnapshot(snapshot, sessionId);
              setState((current) => ({
                ...current,
                snapshot,
                messages: recovered ? [] : current.messages,
                bootstrapping: false,
                rejoining: false,
                error: null,
                notice: recovered
                  ? "Phòng đã được khôi phục sau khi máy chủ khởi động lại."
                  : null,
              }));
            })
            .catch((cause: unknown) => {
              if (cancelled) return;
              setState((current) => ({
                ...current,
                bootstrapping: false,
                rejoining: false,
                error: cause instanceof Error ? cause.message : "Không thể vào lại phòng.",
              }));
            });
        });
        socket.on("room:snapshot", (snapshot: RoomSnapshot) => {
          updateActiveRoomSnapshot(snapshot, sessionIdRef.current);
          setState((current) => ({ ...current, snapshot, rejoining: false, error: null }));
        });
        socket.on("chat:created", (message: ChatMessage) =>
          setState((current) => ({
            ...current,
            messages: [...current.messages.slice(-99), message],
          })),
        );
        socket.on("app:error", (error: { code: string; message: string }) => {
          if (error.code === "UNAUTHORIZED") {
            resetSessionToken();
            void getSessionToken()
              .then((nextToken) => {
                if (cancelled) return;
                socket.auth = { token: nextToken };
                socket.connect();
              })
              .catch(() => undefined);
          }
          setState((current) => ({ ...current, error: error.message }));
        });
        socket.connect();
      })
      .catch((error: unknown) =>
        setState((current) => ({
          ...current,
          connecting: false,
          bootstrapping: false,
          error: error instanceof Error ? error.message : "Không thể khởi tạo ứng dụng.",
        })),
      );

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  const emit = useCallback(
    <T,>(event: string, payload?: unknown) => {
      const socket = socketRef.current;
      return socket
        ? emitWithAck<T>(socket, event, payload)
        : Promise.reject(new Error("Chưa kết nối với máy chủ."));
    },
    [],
  );

  const createRoom = useCallback(
    async (name: string) => {
      const snapshot = await emit<RoomSnapshot>("room:create", {
        name,
        avatarUrl: loadBrowserProfile().avatarUrl,
      });
      saveActiveRoomSession(snapshot.roomCode, name, snapshot);
      setState((current) => ({ ...current, snapshot, messages: [], error: null }));
      return snapshot;
    },
    [emit],
  );

  const joinRoom = useCallback(
    async (roomCode: string, name: string, recoverMissing = false) => {
      const avatarUrl = loadBrowserProfile().avatarUrl;
      const result = recoverMissing
        ? await emit<RoomResumeResult>("room:resume", {
            roomCode,
            name,
            avatarUrl,
            recovery: null,
          })
        : null;
      const snapshot = result?.snapshot ?? await emit<RoomSnapshot>("room:join", {
        roomCode,
        name,
        avatarUrl,
      });
      saveActiveRoomSession(snapshot.roomCode, name, snapshot);
      setState((current) => ({
        ...current,
        snapshot,
        messages: [],
        error: null,
        notice: result?.recovered
          ? "Máy chủ vừa khởi động lại nên phòng đã được tạo lại với cùng mã."
          : null,
      }));
      return snapshot;
    },
    [emit],
  );

  const leaveRoom = useCallback(async () => {
    clearActiveRoomSession();
    if (socketRef.current?.connected) await emit<null>("room:leave").catch(() => null);
    setState((current) => ({ ...current, snapshot: null, messages: [] }));
  }, [emit]);

  const addVideo = useCallback((url: string) => emit<RoomSnapshot>("queue:add", { url }), [emit]);
  const removeVideo = useCallback(
    (itemId: string) => emit<RoomSnapshot>("queue:remove", { itemId }),
    [emit],
  );
  const playQueuedVideo = useCallback(
    (itemId: string) => emit<RoomSnapshot>("queue:play", { itemId }),
    [emit],
  );
  const command = useCallback(
    (action: PlaybackCommand, positionSec = 0) =>
      emit<RoomSnapshot>("playback:command", { action, positionSec }),
    [emit],
  );
  const sendChat = useCallback(
    (text: string, replyTo?: ChatReply) => emit<{ id: string }>("chat:send", { text, replyTo }),
    [emit],
  );
  const updateProfile = useCallback(async (profile: SharedProfile) => {
    updateActiveRoomName(profile.name);
    const snapshot = await emit<RoomSnapshot>("profile:update", profile);
    setState((current) => ({ ...current, snapshot, error: null }));
    return snapshot;
  }, [emit]);

  return {
    ...state,
    createRoom,
    joinRoom,
    leaveRoom,
    addVideo,
    removeVideo,
    playQueuedVideo,
    command,
    sendChat,
    updateProfile,
  };
}
