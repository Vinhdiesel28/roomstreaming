export type PlaybackState = "playing" | "paused";

export interface Playback {
  videoId: string;
  state: PlaybackState;
  positionSec: number;
  changedAt: number;
  version: number;
}

export interface QueueItem {
  itemId: string;
  videoId: string;
  addedBySessionId: string;
  addedByName: string;
  addedAt: number;
}

export interface MemberPublic {
  sessionId: string;
  name: string;
  joinedAt: number;
  online: boolean;
  isHost: boolean;
}

export interface MemberInternal {
  sessionId: string;
  name: string;
  joinedAt: number;
  socketIds: Set<string>;
}

export interface RoomRecord {
  code: string;
  hostSessionId: string;
  currentVideo: Playback | null;
  queue: QueueItem[];
  queueVersion: number;
  members: Map<string, MemberInternal>;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface RoomSnapshot {
  roomCode: string;
  hostSessionId: string;
  isHost: boolean;
  currentVideo: Playback | null;
  queue: QueueItem[];
  queueVersion: number;
  members: MemberPublic[];
  serverTime: number;
}

export interface ChatReply {
  messageId: string;
  senderName: string;
  text: string;
}

export interface ChatMessage {
  id: string;
  senderSessionId: string;
  senderName: string;
  text: string;
  sentAt: number;
  replyTo?: ChatReply;
}

export interface AckSuccess<T> {
  ok: true;
  data: T;
}

export interface AckFailure {
  ok: false;
  error: { code: string; message: string };
}

export type Ack<T> = AckSuccess<T> | AckFailure;
