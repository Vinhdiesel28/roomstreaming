import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { randomInt, randomUUID } from "node:crypto";
import type {
  MemberInternal,
  Playback,
  QueueItem,
  RoomRecoveryState,
  RoomRecord,
  RoomSnapshot,
} from "./room.types";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_MEMBERS = 20;
const MAX_QUEUE = 50;
const MAX_RECENT_VIDEOS = 5;
const MAX_SKIPPED_VIDEOS = 20;

@Injectable()
export class RoomStore implements OnModuleDestroy {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly socketToRoom = new Map<string, string>();
  private readonly ttlMs = Number(process.env.ROOM_TTL_HOURS ?? 6) * 60 * 60 * 1000;
  private readonly cleanupTimer = setInterval(() => this.cleanup(), 60_000);

  get size() {
    return this.rooms.size;
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  create(hostSessionId: string, name: string, avatarUrl: string | null = null) {
    let code = this.generateCode();
    while (this.rooms.has(code)) code = this.generateCode();
    return this.createRecord(code, hostSessionId, name, avatarUrl);
  }

  resume(
    code: string,
    sessionId: string,
    socketId: string,
    name: string,
    avatarUrl: string | null,
    recovery: RoomRecoveryState | null,
  ) {
    const existing = this.get(code);
    if (existing) {
      return {
        room: this.join(code, sessionId, socketId, name, avatarUrl),
        recovered: false,
      };
    }

    const room = this.createRecord(code.toUpperCase(), sessionId, name, avatarUrl, recovery);
    this.join(room.code, sessionId, socketId, name, avatarUrl);
    return { room, recovered: true };
  }

  private createRecord(
    code: string,
    hostSessionId: string,
    name: string,
    avatarUrl: string | null,
    recovery: RoomRecoveryState | null = null,
  ) {
    const now = Date.now();
    const room: RoomRecord = {
      code,
      hostSessionId,
      currentVideo: recovery?.currentVideo
        ? {
            ...recovery.currentVideo,
            changedAt: now,
            version: 1,
          }
        : null,
      recentVideoIds: [],
      skippedVideoIds: [],
      queue: (recovery?.queue ?? []).map((item) => ({
        itemId: randomUUID(),
        ...item,
        addedBySessionId: hostSessionId,
        addedAt: now,
      })),
      queueVersion: recovery?.queue.length ?? 0,
      members: new Map(),
      createdAt: now,
      updatedAt: now,
      expiresAt: now + this.ttlMs,
    };
    room.members.set(hostSessionId, this.newMember(hostSessionId, name, avatarUrl));
    this.rooms.set(code, room);
    return room;
  }

  get(code: string) {
    return this.rooms.get(code.toUpperCase()) ?? null;
  }

  join(
    code: string,
    sessionId: string,
    socketId: string,
    name: string,
    avatarUrl: string | null = null,
  ) {
    const room = this.get(code);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    const existing = room.members.get(sessionId);
    const onlineMembers = [...room.members.values()].filter((member) => member.socketIds.size > 0);
    if (!existing && onlineMembers.length >= MAX_MEMBERS) throw new Error("ROOM_FULL");

    const member = existing ?? this.newMember(sessionId, name, avatarUrl);
    member.name = name;
    member.avatarUrl = avatarUrl;
    member.socketIds.add(socketId);
    room.members.set(sessionId, member);
    this.socketToRoom.set(socketId, room.code);
    this.touch(room);
    return room;
  }

  leave(socketId: string) {
    const code = this.socketToRoom.get(socketId);
    if (!code) return null;
    this.socketToRoom.delete(socketId);
    const room = this.get(code);
    if (!room) return null;

    let departedSessionId: string | null = null;
    for (const member of room.members.values()) {
      if (!member.socketIds.delete(socketId)) continue;
      departedSessionId = member.sessionId;
      break;
    }
    this.touch(room);
    return departedSessionId ? { room, departedSessionId } : null;
  }

  roomForSocket(socketId: string) {
    const code = this.socketToRoom.get(socketId);
    return code ? this.get(code) : null;
  }

  member(room: RoomRecord, sessionId: string) {
    return room.members.get(sessionId) ?? null;
  }

  updateProfile(room: RoomRecord, sessionId: string, name: string, avatarUrl: string | null) {
    const member = this.member(room, sessionId);
    if (!member) throw new Error("NOT_IN_ROOM");
    member.name = name;
    member.avatarUrl = avatarUrl;
    this.touch(room);
  }

  snapshot(room: RoomRecord, viewerSessionId: string): RoomSnapshot {
    return {
      roomCode: room.code,
      hostSessionId: room.hostSessionId,
      isHost: room.hostSessionId === viewerSessionId,
      currentVideo: room.currentVideo ? { ...room.currentVideo } : null,
      recentVideoIds: [...room.recentVideoIds],
      skippedVideoIds: [...room.skippedVideoIds],
      queue: room.queue.map((item) => ({ ...item })),
      queueVersion: room.queueVersion,
      members: [...room.members.values()]
        .map((member) => ({
          sessionId: member.sessionId,
          name: member.name,
          avatarUrl: member.avatarUrl,
          joinedAt: member.joinedAt,
          online: member.socketIds.size > 0,
          isHost: member.sessionId === room.hostSessionId,
        }))
        .filter((member) => member.online)
        .sort((a, b) => a.joinedAt - b.joinedAt),
      serverTime: Date.now(),
    };
  }

  addVideo(
    room: RoomRecord,
    sessionId: string,
    video: Pick<QueueItem, "videoId" | "title" | "channelTitle" | "thumbnailUrl">,
  ) {
    const member = this.member(room, sessionId);
    if (!member) throw new Error("NOT_IN_ROOM");
    if (room.queue.length >= MAX_QUEUE) throw new Error("QUEUE_FULL");
    room.skippedVideoIds = room.skippedVideoIds.filter((id) => id !== video.videoId);
    const now = Date.now();
    if (!room.currentVideo) {
      room.currentVideo = {
        videoId: video.videoId,
        state: "paused",
        positionSec: 0,
        changedAt: now,
        version: 1,
      };
    } else {
      room.queue.push({
        itemId: randomUUID(),
        ...video,
        addedBySessionId: sessionId,
        addedByName: member.name,
        addedAt: now,
      });
      room.queueVersion += 1;
    }
    this.touch(room);
  }

  playVideoNow(room: RoomRecord, sessionId: string, itemId: string) {
    if (room.hostSessionId !== sessionId) throw new Error("HOST_ONLY");
    const index = room.queue.findIndex((item) => item.itemId === itemId);
    if (index < 0) throw new Error("QUEUE_ITEM_NOT_FOUND");
    const [item] = room.queue.splice(index, 1);
    if (!item) throw new Error("QUEUE_ITEM_NOT_FOUND");
    const now = Date.now();
    this.rememberCurrentVideo(room);
    room.queueVersion += 1;
    room.currentVideo = {
      videoId: item.videoId,
      state: "playing",
      positionSec: 0,
      changedAt: now,
      version: (room.currentVideo?.version ?? 0) + 1,
    };
    this.touch(room);
  }

  removeVideo(room: RoomRecord, sessionId: string, itemId: string) {
    const index = room.queue.findIndex((item) => item.itemId === itemId);
    if (index < 0) throw new Error("QUEUE_ITEM_NOT_FOUND");
    const item = room.queue[index];
    if (room.hostSessionId !== sessionId && item?.addedBySessionId !== sessionId) {
      throw new Error("FORBIDDEN");
    }
    if (item) this.rememberSkippedVideo(room, item.videoId);
    room.queue.splice(index, 1);
    room.queueVersion += 1;
    this.touch(room);
  }

  command(
    room: RoomRecord,
    sessionId: string,
    action: "PLAY" | "PAUSE" | "SEEK" | "NEXT",
    positionSec?: number,
  ) {
    if (room.hostSessionId !== sessionId) throw new Error("HOST_ONLY");
    const now = Date.now();
    if (action === "NEXT") {
      if (Number(positionSec ?? 0) < 0 && room.currentVideo) {
        this.rememberSkippedVideo(room, room.currentVideo.videoId);
      }
      this.rememberCurrentVideo(room);
      const next = room.queue.shift();
      room.queueVersion += 1;
      room.currentVideo = next
        ? {
            videoId: next.videoId,
            state: "playing",
            positionSec: 0,
            changedAt: now,
            version: (room.currentVideo?.version ?? 0) + 1,
          }
        : null;
      this.touch(room);
      return;
    }

    if (!room.currentVideo) throw new Error("NO_VIDEO");
    const safePosition = Math.max(0, Math.min(Number(positionSec ?? 0), 24 * 60 * 60));
    room.currentVideo = {
      ...room.currentVideo,
      state: action === "PLAY" ? "playing" : action === "PAUSE" ? "paused" : room.currentVideo.state,
      positionSec: safePosition,
      changedAt: now,
      version: room.currentVideo.version + 1,
    };
    this.touch(room);
  }

  transferHostIfOffline(room: RoomRecord) {
    const currentHost = room.members.get(room.hostSessionId);
    if (currentHost && currentHost.socketIds.size > 0) return false;
    const next = [...room.members.values()]
      .filter((member) => member.socketIds.size > 0)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (!next) return false;
    room.hostSessionId = next.sessionId;
    this.touch(room);
    return true;
  }

  isOnline(room: RoomRecord, sessionId: string) {
    return (room.members.get(sessionId)?.socketIds.size ?? 0) > 0;
  }

  private touch(room: RoomRecord) {
    const now = Date.now();
    room.updatedAt = now;
    room.expiresAt = now + this.ttlMs;
  }

  private rememberCurrentVideo(room: RoomRecord) {
    const videoId = room.currentVideo?.videoId;
    if (!videoId) return;
    room.recentVideoIds = [
      videoId,
      ...room.recentVideoIds.filter((id) => id !== videoId),
    ].slice(0, MAX_RECENT_VIDEOS);
  }

  private rememberSkippedVideo(room: RoomRecord, videoId: string) {
    room.skippedVideoIds = [
      videoId,
      ...room.skippedVideoIds.filter((id) => id !== videoId),
    ].slice(0, MAX_SKIPPED_VIDEOS);
  }

  private newMember(sessionId: string, name: string, avatarUrl: string | null): MemberInternal {
    return { sessionId, name, avatarUrl, joinedAt: Date.now(), socketIds: new Set() };
  }

  private generateCode() {
    return Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  }

  private cleanup() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const hasOnlineMembers = [...room.members.values()].some((member) => member.socketIds.size > 0);
      if (!hasOnlineMembers && room.expiresAt <= now) this.rooms.delete(code);
    }
  }
}
