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
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  addedBySessionId: string;
  addedByName: string;
  addedAt: number;
}

export interface Member {
  sessionId: string;
  name: string;
  joinedAt: number;
  online: boolean;
  isHost: boolean;
}

export interface RoomSnapshot {
  roomCode: string;
  hostSessionId: string;
  isHost: boolean;
  currentVideo: Playback | null;
  queue: QueueItem[];
  queueVersion: number;
  members: Member[];
  serverTime: number;
}

export interface ChatMessage {
  id: string;
  senderSessionId: string;
  senderName: string;
  text: string;
  sentAt: number;
  replyTo?: ChatReply;
}

export interface ChatReply {
  messageId: string;
  senderName: string;
  text: string;
}

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
}

export interface VoicePeer {
  socketId: string;
  name: string;
  muted: boolean;
}

export interface VoiceJoinResult {
  selfSocketId: string;
  peers: VoicePeer[];
  maxParticipants: number;
}

export interface VoiceSignal {
  source: VoicePeer;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export type Ack<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export type PlaybackCommand = "PLAY" | "PAUSE" | "SEEK" | "NEXT";
