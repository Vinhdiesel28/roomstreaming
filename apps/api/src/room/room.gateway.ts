import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Inject } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import { SessionService } from "../session/session.service";
import { YouTubeSearchService } from "../youtube/youtube-search.service";
import { RateLimiter } from "./rate-limiter";
import { RoomStore } from "./room.store";
import type { Ack, ChatMessage, ChatReply, RoomRecord, RoomSnapshot } from "./room.types";
import { parseYouTubeVideoId } from "./youtube";
import {
  MAX_VOICE_PARTICIPANTS,
  VoiceRegistry,
  type VoicePeerPublic,
} from "../voice/voice.registry";

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

interface AuthedSocket extends Socket {
  data: { sessionId: string };
}

interface VoiceDescription {
  type: "offer" | "answer";
  sdp: string;
}

interface VoiceCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

@WebSocketGateway({
  cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
})
export class RoomGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly hostTimers = new Map<string, NodeJS.Timeout>();
  private readonly graceMs =
    Number(process.env.HOST_RECONNECT_GRACE_SECONDS ?? 60) * 1000;

  constructor(
    @Inject(SessionService)
    private readonly sessions: SessionService,
    @Inject(RoomStore)
    private readonly rooms: RoomStore,
    @Inject(RateLimiter)
    private readonly limiter: RateLimiter,
    @Inject(VoiceRegistry)
    private readonly voice: VoiceRegistry,
    @Inject(YouTubeSearchService)
    private readonly youtube: YouTubeSearchService,
  ) {}

  handleConnection(client: AuthedSocket) {
    const sessionId = this.sessions.verify(client.handshake.auth?.token);
    if (!sessionId) {
      client.emit("app:error", { code: "UNAUTHORIZED", message: "Phiên đã hết hạn. Hãy tải lại trang." });
      client.disconnect(true);
      return;
    }
    client.data.sessionId = sessionId;
    client.emit("session:ready", { sessionId, serverTime: Date.now() });
  }

  handleDisconnect(client: AuthedSocket) {
    this.leaveVoice(client.id);
    const result = this.rooms.leave(client.id);
    if (!result) return;
    const { room, departedSessionId } = result;
    this.broadcastSnapshot(room);
    if (room.hostSessionId === departedSessionId && !this.rooms.isOnline(room, departedSessionId)) {
      this.scheduleHostTransfer(room);
    }
  }

  @SubscribeMessage("room:create")
  async createRoom(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: { name?: unknown },
  ): Promise<Ack<RoomSnapshot>> {
    return this.safe(client, "create", 3, 60_000, async () => {
      const name = this.name(payload?.name);
      const room = this.rooms.create(client.data.sessionId, name);
      this.rooms.join(room.code, client.data.sessionId, client.id, name);
      await client.join(room.code);
      return this.rooms.snapshot(room, client.data.sessionId);
    });
  }

  @SubscribeMessage("room:join")
  async joinRoom(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: { roomCode?: unknown; name?: unknown },
  ): Promise<Ack<RoomSnapshot>> {
    return this.safe(client, "join", 12, 60_000, async () => {
      const name = this.name(payload?.name);
      const code = this.code(payload?.roomCode);
      const room = this.rooms.join(code, client.data.sessionId, client.id, name);
      await client.join(room.code);
      this.cancelHostTransferIfBack(room, client.data.sessionId);
      this.broadcastSnapshot(room);
      this.server.to(room.code).emit("member:joined", { name, at: Date.now() });
      return this.rooms.snapshot(room, client.data.sessionId);
    });
  }

  @SubscribeMessage("room:leave")
  async leaveRoom(@ConnectedSocket() client: AuthedSocket): Promise<Ack<null>> {
    return this.safe(client, "leave", 5, 10_000, async () => {
      this.leaveVoice(client.id);
      const result = this.rooms.leave(client.id);
      if (!result) return null;
      await client.leave(result.room.code);
      const wasHost = result.room.hostSessionId === result.departedSessionId;
      if (wasHost && !this.rooms.isOnline(result.room, result.departedSessionId)) {
        this.rooms.transferHostIfOffline(result.room);
      }
      this.broadcastSnapshot(result.room);
      this.server.to(result.room.code).emit("member:left", { at: Date.now() });
      return null;
    });
  }

  @SubscribeMessage("voice:join")
  joinVoice(@ConnectedSocket() client: AuthedSocket): Ack<{
    selfSocketId: string;
    peers: VoicePeerPublic[];
    maxParticipants: number;
  }> {
    return this.safeSync(client, "voice-join", 5, 60_000, () => {
      const room = this.requireRoom(client);
      const member = this.rooms.member(room, client.data.sessionId);
      if (!member) throw new Error("NOT_IN_ROOM");
      const peers = this.voice.join({
        socketId: client.id,
        roomCode: room.code,
        sessionId: client.data.sessionId,
        name: member.name,
      });
      const joinedPeer = this.voice.get(client.id);
      if (!joinedPeer) throw new Error("VOICE_NOT_JOINED");
      const publicPeer = {
        socketId: joinedPeer.socketId,
        name: joinedPeer.name,
        muted: joinedPeer.muted,
      };
      for (const peer of peers) {
        this.server.to(peer.socketId).emit("voice:peer-joined", publicPeer);
      }
      return { selfSocketId: client.id, peers, maxParticipants: MAX_VOICE_PARTICIPANTS };
    });
  }

  @SubscribeMessage("voice:leave")
  leaveVoiceRoom(@ConnectedSocket() client: AuthedSocket): Ack<null> {
    return this.safeSync(client, "voice-leave", 10, 60_000, () => {
      this.leaveVoice(client.id);
      return null;
    });
  }

  @SubscribeMessage("voice:mute")
  muteVoice(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: { muted?: unknown },
  ): Ack<{ muted: boolean }> {
    return this.safeSync(client, "voice-mute", 30, 60_000, () => {
      if (typeof payload?.muted !== "boolean") throw new Error("INVALID_VOICE_STATE");
      const peer = this.voice.setMuted(client.id, payload.muted);
      const current = this.voice.get(client.id);
      if (!current) throw new Error("VOICE_NOT_JOINED");
      for (const target of this.voice.list(current.roomCode, client.id)) {
        this.server.to(target.socketId).emit("voice:peer-muted", peer);
      }
      return { muted: peer.muted };
    });
  }

  @SubscribeMessage("voice:signal")
  signalVoice(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: {
      targetSocketId?: unknown;
      description?: unknown;
      candidate?: unknown;
    },
  ): Ack<null> {
    return this.safeSync(client, "voice-signal", 240, 60_000, () => {
      const targetSocketId =
        typeof payload?.targetSocketId === "string" ? payload.targetSocketId : "";
      if (!targetSocketId || !this.voice.sameRoom(client.id, targetSocketId)) {
        throw new Error("INVALID_VOICE_TARGET");
      }
      const description = this.voiceDescription(payload.description);
      const candidate = this.voiceCandidate(payload.candidate);
      if (!description && !candidate) throw new Error("INVALID_VOICE_SIGNAL");
      const source = this.voice.get(client.id);
      if (!source) throw new Error("VOICE_NOT_JOINED");

      this.server.to(targetSocketId).emit("voice:signal", {
        source: { socketId: source.socketId, name: source.name, muted: source.muted },
        description,
        candidate,
      });
      return null;
    });
  }

  @SubscribeMessage("queue:add")
  async addVideo(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: { url?: unknown },
  ): Promise<Ack<RoomSnapshot>> {
    return this.safe(client, "queue-add", 8, 30_000, async () => {
      const room = this.requireRoom(client);
      const videoId = parseYouTubeVideoId(payload?.url);
      if (!videoId) throw new Error("INVALID_YOUTUBE_URL");
      await this.youtube.ensurePlayable(videoId);
      this.rooms.addVideo(room, client.data.sessionId, videoId);
      this.broadcastSnapshot(room);
      return this.rooms.snapshot(room, client.data.sessionId);
    });
  }

  @SubscribeMessage("queue:remove")
  removeVideo(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: { itemId?: unknown },
  ): Ack<RoomSnapshot> {
    return this.safeSync(client, "queue-remove", 10, 30_000, () => {
      const room = this.requireRoom(client);
      const itemId = typeof payload?.itemId === "string" ? payload.itemId : "";
      this.rooms.removeVideo(room, client.data.sessionId, itemId);
      this.broadcastSnapshot(room);
      return this.rooms.snapshot(room, client.data.sessionId);
    });
  }

  @SubscribeMessage("playback:command")
  playback(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody()
    payload: { action?: unknown; positionSec?: unknown },
  ): Ack<RoomSnapshot> {
    return this.safeSync(client, "playback", 30, 10_000, () => {
      const room = this.requireRoom(client);
      const validActions = ["PLAY", "PAUSE", "SEEK", "NEXT"] as const;
      const action = validActions.find((candidate) => candidate === payload?.action);
      if (!action) throw new Error("INVALID_ACTION");
      const positionSec = Number(payload?.positionSec ?? 0);
      if (!Number.isFinite(positionSec)) throw new Error("INVALID_POSITION");
      this.rooms.command(room, client.data.sessionId, action, positionSec);
      this.broadcastSnapshot(room);
      return this.rooms.snapshot(room, client.data.sessionId);
    });
  }

  @SubscribeMessage("chat:send")
  sendChat(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: { text?: unknown; replyTo?: unknown },
  ): Ack<{ id: string }> {
    return this.safeSync(client, "chat", 6, 10_000, () => {
      const room = this.requireRoom(client);
      const member = this.rooms.member(room, client.data.sessionId);
      if (!member) throw new Error("NOT_IN_ROOM");
      const text = typeof payload?.text === "string" ? payload.text.trim() : "";
      if (!text || text.length > 500) throw new Error("INVALID_MESSAGE");
      const replyTo = parseChatReply(payload?.replyTo);
      if (payload?.replyTo !== undefined && !replyTo) throw new Error("INVALID_MESSAGE");
      const message: ChatMessage = {
        id: randomUUID(),
        senderSessionId: client.data.sessionId,
        senderName: member.name,
        text,
        sentAt: Date.now(),
        ...(replyTo ? { replyTo } : {}),
      };
      this.server.to(room.code).emit("chat:created", message);
      return { id: message.id };
    });
  }

  private broadcastSnapshot(room: RoomRecord) {
    for (const member of room.members.values()) {
      const snapshot = this.rooms.snapshot(room, member.sessionId);
      for (const socketId of member.socketIds) this.server.to(socketId).emit("room:snapshot", snapshot);
    }
  }

  private leaveVoice(socketId: string) {
    const peer = this.voice.leave(socketId);
    if (!peer) return;
    for (const target of this.voice.list(peer.roomCode)) {
      this.server.to(target.socketId).emit("voice:peer-left", { socketId: peer.socketId });
    }
  }

  private voiceDescription(value: unknown): VoiceDescription | undefined {
    if (!value || typeof value !== "object") return undefined;
    const input = value as { type?: unknown; sdp?: unknown };
    if (
      (input.type !== "offer" && input.type !== "answer") ||
      typeof input.sdp !== "string" ||
      input.sdp.length < 1 ||
      input.sdp.length > 100_000
    ) {
      throw new Error("INVALID_VOICE_SIGNAL");
    }
    return { type: input.type, sdp: input.sdp };
  }

  private voiceCandidate(value: unknown): VoiceCandidate | undefined {
    if (!value || typeof value !== "object") return undefined;
    const input = value as Record<string, unknown>;
    if (
      typeof input.candidate !== "string" ||
      input.candidate.length < 1 ||
      input.candidate.length > 8_192
    ) {
      throw new Error("INVALID_VOICE_SIGNAL");
    }
    const candidate: VoiceCandidate = { candidate: input.candidate };
    if (typeof input.sdpMid === "string" || input.sdpMid === null) {
      candidate.sdpMid = input.sdpMid;
    }
    if (typeof input.sdpMLineIndex === "number" || input.sdpMLineIndex === null) {
      candidate.sdpMLineIndex = input.sdpMLineIndex;
    }
    if (typeof input.usernameFragment === "string" || input.usernameFragment === null) {
      candidate.usernameFragment = input.usernameFragment;
    }
    return candidate;
  }

  private scheduleHostTransfer(room: RoomRecord) {
    if (this.hostTimers.has(room.code)) return;
    const timer = setTimeout(() => {
      this.hostTimers.delete(room.code);
      if (this.rooms.transferHostIfOffline(room)) {
        this.broadcastSnapshot(room);
        this.server.to(room.code).emit("host:changed", { hostSessionId: room.hostSessionId });
      }
    }, this.graceMs);
    timer.unref();
    this.hostTimers.set(room.code, timer);
  }

  private cancelHostTransferIfBack(room: RoomRecord, sessionId: string) {
    if (room.hostSessionId !== sessionId) return;
    const timer = this.hostTimers.get(room.code);
    if (!timer) return;
    clearTimeout(timer);
    this.hostTimers.delete(room.code);
  }

  private requireRoom(client: AuthedSocket) {
    const room = this.rooms.roomForSocket(client.id);
    if (!room) throw new Error("NOT_IN_ROOM");
    return room;
  }

  private name(value: unknown) {
    if (typeof value !== "string") throw new Error("INVALID_NAME");
    const name = value.replace(/[<>]/g, "").trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 32) throw new Error("INVALID_NAME");
    return name;
  }

  private code(value: unknown) {
    if (typeof value !== "string") throw new Error("INVALID_ROOM_CODE");
    const code = value.trim().toUpperCase();
    if (!/^[A-Z2-9]{8}$/.test(code)) throw new Error("INVALID_ROOM_CODE");
    return code;
  }

  private async safe<T>(
    client: AuthedSocket,
    event: string,
    limit: number,
    windowMs: number,
    task: () => Promise<T>,
  ): Promise<Ack<T>> {
    if (!this.limiter.allow(`${client.data.sessionId}:${event}`, limit, windowMs)) {
      return this.failure("RATE_LIMITED");
    }
    try {
      return { ok: true, data: await task() };
    } catch (error) {
      return this.failure(error instanceof Error ? error.message : "UNKNOWN_ERROR");
    }
  }

  private safeSync<T>(
    client: AuthedSocket,
    event: string,
    limit: number,
    windowMs: number,
    task: () => T,
  ): Ack<T> {
    if (!this.limiter.allow(`${client.data.sessionId}:${event}`, limit, windowMs)) {
      return this.failure("RATE_LIMITED");
    }
    try {
      return { ok: true, data: task() };
    } catch (error) {
      return this.failure(error instanceof Error ? error.message : "UNKNOWN_ERROR");
    }
  }

  private failure(code: string): Ack<never> {
    const messages: Record<string, string> = {
      ROOM_NOT_FOUND: "Không tìm thấy phòng này. Kiểm tra lại mã phòng.",
      ROOM_FULL: "Phòng đã đủ 20 người.",
      INVALID_NAME: "Tên cần từ 2 đến 32 ký tự.",
      INVALID_ROOM_CODE: "Mã phòng phải gồm 8 ký tự.",
      INVALID_YOUTUBE_URL: "Link YouTube không hợp lệ hoặc không được hỗ trợ.",
      YOUTUBE_VIDEO_UNAVAILABLE: "Video không tồn tại, đang để riêng tư hoặc không cho phép phát trên web khác.",
      YOUTUBE_API_KEY_MISSING: "Backend chưa được cấu hình YouTube API key.",
      YOUTUBE_SEARCH_QUOTA: "YouTube API đã hết quota hôm nay. Hãy thử lại sau.",
      YOUTUBE_SEARCH_UNAVAILABLE: "YouTube đang không phản hồi nên chưa thể kiểm tra link này.",
      QUEUE_FULL: "Hàng chờ đã đủ 50 video.",
      HOST_ONLY: "Chỉ Host mới điều khiển phát video.",
      FORBIDDEN: "Bạn không có quyền thực hiện thao tác này.",
      RATE_LIMITED: "Bạn thao tác quá nhanh. Chờ một chút rồi thử lại.",
      INVALID_MESSAGE: "Tin nhắn cần từ 1 đến 500 ký tự.",
      NOT_IN_ROOM: "Bạn chưa ở trong phòng.",
      NO_VIDEO: "Phòng chưa có video để điều khiển.",
      VOICE_FULL: "Voice chat đã đủ 8 người.",
      VOICE_NOT_JOINED: "Bạn chưa tham gia voice chat.",
      INVALID_VOICE_STATE: "Trạng thái micro không hợp lệ.",
      INVALID_VOICE_TARGET: "Không thể kết nối voice với thành viên này.",
      INVALID_VOICE_SIGNAL: "Dữ liệu kết nối voice không hợp lệ.",
    };
    return { ok: false, error: { code, message: messages[code] ?? "Không thể thực hiện thao tác này." } };
  }
}

export function parseChatReply(value: unknown): ChatReply | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") return undefined;
  const input = value as { messageId?: unknown; senderName?: unknown; text?: unknown };
  const messageId = typeof input.messageId === "string" ? input.messageId.trim() : "";
  const senderName = typeof input.senderName === "string" ? input.senderName.trim() : "";
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (
    !messageId || messageId.length > 100 ||
    !senderName || senderName.length > 50 ||
    !text || text.length > 500
  ) {
    return undefined;
  }
  return { messageId, senderName, text };
}
