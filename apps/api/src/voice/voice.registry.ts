import { Injectable } from "@nestjs/common";

export const MAX_VOICE_PARTICIPANTS = 8;

export interface VoicePeer {
  socketId: string;
  roomCode: string;
  sessionId: string;
  name: string;
  muted: boolean;
}

export type VoicePeerPublic = Pick<VoicePeer, "socketId" | "name" | "muted">;

@Injectable()
export class VoiceRegistry {
  private readonly peers = new Map<string, VoicePeer>();

  join(peer: Omit<VoicePeer, "muted">): VoicePeerPublic[] {
    const existing = this.peers.get(peer.socketId);
    if (existing) return this.list(peer.roomCode, peer.socketId);
    if (this.list(peer.roomCode).length >= MAX_VOICE_PARTICIPANTS) {
      throw new Error("VOICE_FULL");
    }
    this.peers.set(peer.socketId, { ...peer, muted: false });
    return this.list(peer.roomCode, peer.socketId);
  }

  leave(socketId: string) {
    const peer = this.peers.get(socketId) ?? null;
    if (peer) this.peers.delete(socketId);
    return peer;
  }

  get(socketId: string) {
    return this.peers.get(socketId) ?? null;
  }

  setMuted(socketId: string, muted: boolean) {
    const peer = this.get(socketId);
    if (!peer) throw new Error("VOICE_NOT_JOINED");
    peer.muted = muted;
    return this.publicPeer(peer);
  }

  sameRoom(firstSocketId: string, secondSocketId: string) {
    const first = this.get(firstSocketId);
    const second = this.get(secondSocketId);
    return Boolean(first && second && first.roomCode === second.roomCode);
  }

  list(roomCode: string, excludeSocketId?: string): VoicePeerPublic[] {
    return [...this.peers.values()]
      .filter((peer) => peer.roomCode === roomCode && peer.socketId !== excludeSocketId)
      .map((peer) => this.publicPeer(peer));
  }

  private publicPeer(peer: VoicePeer): VoicePeerPublic {
    return { socketId: peer.socketId, name: peer.name, muted: peer.muted };
  }
}
