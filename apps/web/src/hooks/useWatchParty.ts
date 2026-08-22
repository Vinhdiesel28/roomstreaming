import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { apiUrl, getSessionToken, resetSessionToken } from "../lib/api";
import type { Ack, ChatMessage, ChatReply, PlaybackCommand, RoomSnapshot } from "../types";

interface PartyState {
  socket: Socket | null;
  connected: boolean;
  connecting: boolean;
  sessionId: string | null;
  snapshot: RoomSnapshot | null;
  messages: ChatMessage[];
  error: string | null;
}

const initialState: PartyState = {
  socket: null,
  connected: false,
  connecting: true,
  sessionId: null,
  snapshot: null,
  messages: [],
  error: null,
};

export function useWatchParty() {
  const [state, setState] = useState(initialState);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSessionToken()
      .then((token) => {
        if (cancelled) return;
        const socket = io(apiUrl(), {
          auth: { token },
          transports: ["websocket", "polling"],
          reconnectionDelayMax: 4_000,
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
            error: reason === "io server disconnect" ? "Phiên kết nối đã đóng." : current.error,
          })),
        );
        socket.on("connect_error", (error) =>
          setState((current) => ({
            ...current,
            connecting: socket.active,
            error: error.message.includes("xhr poll error")
              ? "Backend chưa sẵn sàng. Nếu dùng gói miễn phí, máy chủ có thể cần khoảng một phút để thức dậy."
              : "Không kết nối được với máy chủ.",
          })),
        );
        socket.on("session:ready", ({ sessionId }: { sessionId: string }) =>
          setState((current) => ({ ...current, sessionId })),
        );
        socket.on("room:snapshot", (snapshot: RoomSnapshot) =>
          setState((current) => ({ ...current, snapshot })),
        );
        socket.on("chat:created", (message: ChatMessage) =>
          setState((current) => ({
            ...current,
            messages: [...current.messages.slice(-99), message],
          })),
        );
        socket.on("app:error", (error: { code: string; message: string }) => {
          if (error.code === "UNAUTHORIZED") resetSessionToken();
          setState((current) => ({ ...current, error: error.message }));
        });
      })
      .catch((error: unknown) =>
        setState((current) => ({
          ...current,
          connecting: false,
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
    <T,>(event: string, payload?: unknown) =>
      new Promise<T>((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
          reject(new Error("Chưa kết nối với máy chủ."));
          return;
        }
        socket.timeout(10_000).emit(event, payload ?? {}, (error: Error | null, ack: Ack<T>) => {
          if (error) {
            reject(new Error("Máy chủ không phản hồi. Hãy thử lại."));
            return;
          }
          if (!ack.ok) {
            reject(new Error(ack.error.message));
            return;
          }
          resolve(ack.data);
        });
      }),
    [],
  );

  const createRoom = useCallback(
    async (name: string) => {
      const snapshot = await emit<RoomSnapshot>("room:create", { name });
      setState((current) => ({ ...current, snapshot, messages: [], error: null }));
      return snapshot;
    },
    [emit],
  );

  const joinRoom = useCallback(
    async (roomCode: string, name: string) => {
      const snapshot = await emit<RoomSnapshot>("room:join", { roomCode, name });
      setState((current) => ({ ...current, snapshot, messages: [], error: null }));
      return snapshot;
    },
    [emit],
  );

  const leaveRoom = useCallback(async () => {
    await emit<null>("room:leave");
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
  };
}
