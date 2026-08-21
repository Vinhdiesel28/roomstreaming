import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { Ack, VoiceJoinResult, VoicePeer, VoiceSignal } from "../types";

interface TurnConfig {
  url?: string;
  username?: string;
  credential?: string;
}

interface PeerConnection {
  connection: RTCPeerConnection;
  pendingCandidates: RTCIceCandidateInit[];
}

export interface VoiceParticipant extends VoicePeer {
  stream?: MediaStream;
  connectionState: RTCPeerConnectionState | "waiting";
}

type VoiceStatus = "idle" | "joining" | "joined";

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export function buildIceServers(config: TurnConfig = {}): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];
  const url = config.url?.trim();
  if (!url) return servers;
  const username = config.username?.trim();
  const credential = config.credential?.trim();
  servers.push(
    username && credential
      ? { urls: url, username, credential }
      : { urls: url },
  );
  return servers;
}

function emitAck<T>(socket: Socket, event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const callback = (error: Error | null, response?: Ack<T>) => {
      if (error) {
        reject(new Error("Máy chủ voice không phản hồi. Hãy thử lại."));
        return;
      }
      if (!response) {
        reject(new Error("Phản hồi voice không hợp lệ."));
        return;
      }
      if (!response.ok) {
        reject(new Error(response.error.message));
        return;
      }
      resolve(response.data);
    };
    if (payload === undefined) socket.timeout(8_000).emit(event, callback);
    else socket.timeout(8_000).emit(event, payload, callback);
  });
}

function microphoneError(cause: unknown) {
  if (cause instanceof DOMException) {
    if (cause.name === "NotAllowedError") {
      return "Trình duyệt chưa được cấp quyền micro. Hãy cho phép rồi thử lại.";
    }
    if (cause.name === "NotFoundError") return "Không tìm thấy micro trên thiết bị này.";
    if (cause.name === "NotReadableError") return "Micro đang được ứng dụng khác sử dụng.";
  }
  return cause instanceof Error ? cause.message : "Không thể mở micro.";
}

export function useVoiceChat(socket: Socket | null) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [muted, setMuted] = useState(false);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [maxParticipants, setMaxParticipants] = useState(8);
  const socketRef = useRef<Socket | null>(socket);
  const streamRef = useRef<MediaStream | null>(null);
  const joinedRef = useRef(false);
  const peersRef = useRef(new Map<string, PeerConnection>());
  const iceServers = useMemo(
    () =>
      buildIceServers({
        url: import.meta.env.VITE_TURN_URL,
        username: import.meta.env.VITE_TURN_USERNAME,
        credential: import.meta.env.VITE_TURN_CREDENTIAL,
      }),
    [],
  );

  const updateParticipant = useCallback(
    (peer: VoicePeer, patch: Partial<VoiceParticipant> = {}) => {
      setParticipants((current) => {
        const existing = current.find((item) => item.socketId === peer.socketId);
        const next: VoiceParticipant = {
          ...peer,
          stream: existing?.stream,
          connectionState: existing?.connectionState ?? "waiting",
          ...patch,
        };
        return existing
          ? current.map((item) => (item.socketId === peer.socketId ? next : item))
          : [...current, next];
      });
    },
    [],
  );

  const removePeer = useCallback((socketId: string) => {
    const active = peersRef.current.get(socketId);
    if (active) {
      active.connection.onicecandidate = null;
      active.connection.ontrack = null;
      active.connection.close();
      peersRef.current.delete(socketId);
    }
    setParticipants((current) => current.filter((peer) => peer.socketId !== socketId));
  }, []);

  const sendSignal = useCallback(
    (targetSocketId: string, signal: Pick<VoiceSignal, "description" | "candidate">) => {
      socketRef.current?.emit("voice:signal", { targetSocketId, ...signal }, () => undefined);
    },
    [],
  );

  const ensurePeer = useCallback(
    (peer: VoicePeer) => {
      const existing = peersRef.current.get(peer.socketId);
      if (existing) {
        updateParticipant(peer);
        return existing;
      }
      const connection = new RTCPeerConnection({ iceServers });
      const entry: PeerConnection = { connection, pendingCandidates: [] };
      peersRef.current.set(peer.socketId, entry);
      streamRef.current?.getTracks().forEach((track) => {
        connection.addTrack(track, streamRef.current as MediaStream);
      });
      updateParticipant(peer);

      connection.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal(peer.socketId, { candidate: event.candidate.toJSON() });
        }
      };
      connection.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        updateParticipant(peer, { stream, connectionState: connection.connectionState });
      };
      connection.onconnectionstatechange = () => {
        updateParticipant(peer, { connectionState: connection.connectionState });
        if (connection.connectionState === "failed") {
          setError("Một kết nối voice bị chặn bởi mạng. Hãy thử lại hoặc cấu hình TURN.");
        }
      };
      return entry;
    },
    [iceServers, sendSignal, updateParticipant],
  );

  const flushCandidates = useCallback(async (entry: PeerConnection) => {
    const pending = entry.pendingCandidates.splice(0);
    for (const candidate of pending) await entry.connection.addIceCandidate(candidate);
  }, []);

  const handleSignal = useCallback(
    async (signal: VoiceSignal) => {
      if (!joinedRef.current) return;
      try {
        const entry = ensurePeer(signal.source);
        if (signal.description) {
          await entry.connection.setRemoteDescription(signal.description);
          await flushCandidates(entry);
          if (signal.description.type === "offer") {
            const answer = await entry.connection.createAnswer();
            await entry.connection.setLocalDescription(answer);
            sendSignal(signal.source.socketId, { description: answer });
          }
        }
        if (signal.candidate) {
          if (entry.connection.remoteDescription) {
            await entry.connection.addIceCandidate(signal.candidate);
          } else {
            entry.pendingCandidates.push(signal.candidate);
          }
        }
      } catch {
        setError("Không thể thiết lập một kết nối voice. Hãy rời voice rồi thử lại.");
      }
    },
    [ensurePeer, flushCandidates, sendSignal],
  );

  const cleanup = useCallback((notifyServer: boolean, updateUi: boolean) => {
    if (notifyServer && joinedRef.current && socketRef.current?.connected) {
      socketRef.current.emit("voice:leave", () => undefined);
    }
    joinedRef.current = false;
    for (const entry of peersRef.current.values()) entry.connection.close();
    peersRef.current.clear();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (updateUi) {
      setStatus("idle");
      setMuted(false);
      setParticipants([]);
    }
  }, []);

  const join = useCallback(async () => {
    const activeSocket = socketRef.current;
    if (!activeSocket?.connected || status !== "idle") return;
    setStatus("joining");
    setError(null);
    let stream: MediaStream | null = null;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("Voice chat cần HTTPS hoặc localhost để dùng micro.");
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
      streamRef.current = stream;
      const result = await emitAck<VoiceJoinResult>(activeSocket, "voice:join");
      joinedRef.current = true;
      setMaxParticipants(result.maxParticipants);
      setParticipants([]);
      setStatus("joined");
      for (const peer of result.peers) {
        const entry = ensurePeer(peer);
        const offer = await entry.connection.createOffer();
        await entry.connection.setLocalDescription(offer);
        sendSignal(peer.socketId, { description: offer });
      }
    } catch (cause) {
      stream?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      joinedRef.current = false;
      setStatus("idle");
      setError(microphoneError(cause));
    }
  }, [ensurePeer, sendSignal, status]);

  const leave = useCallback(async () => {
    const activeSocket = socketRef.current;
    cleanup(false, true);
    if (!activeSocket?.connected) return;
    try {
      await emitAck<null>(activeSocket, "voice:leave");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể rời voice đúng cách.");
    }
  }, [cleanup]);

  const toggleMute = useCallback(async () => {
    const activeSocket = socketRef.current;
    if (!activeSocket?.connected || !joinedRef.current) return;
    const nextMuted = !muted;
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setMuted(nextMuted);
    try {
      await emitAck<{ muted: boolean }>(activeSocket, "voice:mute", { muted: nextMuted });
    } catch (cause) {
      streamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = nextMuted;
      });
      setMuted(!nextMuted);
      setError(cause instanceof Error ? cause.message : "Không đổi được trạng thái micro.");
    }
  }, [muted]);

  useEffect(() => {
    socketRef.current = socket;
    if (!socket) return;
    const onPeerJoined = (peer: VoicePeer) => updateParticipant(peer);
    const onPeerMuted = (peer: VoicePeer) => updateParticipant(peer);
    const onPeerLeft = ({ socketId }: { socketId: string }) => removePeer(socketId);
    const onSignal = (signal: VoiceSignal) => void handleSignal(signal);
    const onDisconnect = () => {
      const wasJoined = joinedRef.current;
      cleanup(false, true);
      if (wasJoined) setError("Kết nối máy chủ bị gián đoạn. Hãy tham gia lại voice.");
    };
    socket.on("voice:peer-joined", onPeerJoined);
    socket.on("voice:peer-muted", onPeerMuted);
    socket.on("voice:peer-left", onPeerLeft);
    socket.on("voice:signal", onSignal);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("voice:peer-joined", onPeerJoined);
      socket.off("voice:peer-muted", onPeerMuted);
      socket.off("voice:peer-left", onPeerLeft);
      socket.off("voice:signal", onSignal);
      socket.off("disconnect", onDisconnect);
      cleanup(true, false);
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [cleanup, handleSignal, removePeer, socket, updateParticipant]);

  return {
    status,
    muted,
    participants,
    error,
    maxParticipants,
    join,
    leave,
    toggleMute,
    clearError: () => setError(null),
  };
}
