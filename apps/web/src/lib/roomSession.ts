import type { RoomRecoveryState, RoomSnapshot } from "../types";

const ACTIVE_ROOM_KEY = "watchroom.active-room";

export interface ActiveRoomSession {
  roomCode: string;
  name: string;
  recovery: RoomRecoveryState | null;
  savedAt: number;
}

function validRoomCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z2-9]{8}$/.test(value);
}

function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 2 && value.trim().length <= 32;
}

export function loadActiveRoomSession(expectedCode?: string): ActiveRoomSession | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ACTIVE_ROOM_KEY) ?? "null") as Partial<ActiveRoomSession> | null;
    if (!parsed || !validRoomCode(parsed.roomCode) || !validName(parsed.name)) return null;
    if (expectedCode && parsed.roomCode !== expectedCode.toUpperCase()) return null;
    const savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : 0;
    const recovery = parsed.recovery && typeof parsed.recovery === "object"
      ? advanceRecovery(parsed.recovery as RoomRecoveryState, savedAt)
      : null;
    return {
      roomCode: parsed.roomCode,
      name: parsed.name.trim(),
      recovery,
      savedAt,
    };
  } catch {
    return null;
  }
}

export function saveActiveRoomSession(roomCode: string, name: string, snapshot?: RoomSnapshot) {
  if (typeof sessionStorage === "undefined") return;
  const existing = loadActiveRoomSession(roomCode);
  const session: ActiveRoomSession = {
    roomCode: roomCode.toUpperCase(),
    name: name.trim(),
    recovery: snapshot ? recoveryFromSnapshot(snapshot) : existing?.recovery ?? null,
    savedAt: Date.now(),
  };
  try {
    sessionStorage.setItem(ACTIVE_ROOM_KEY, JSON.stringify(session));
  } catch {
    // A full or disabled sessionStorage must not break the room connection.
  }
}

export function updateActiveRoomSnapshot(snapshot: RoomSnapshot, sessionId: string | null) {
  const existing = loadActiveRoomSession(snapshot.roomCode);
  const memberName = snapshot.members.find((member) => member.sessionId === sessionId)?.name;
  const name = memberName ?? existing?.name;
  if (name) saveActiveRoomSession(snapshot.roomCode, name, snapshot);
}

export function updateActiveRoomName(name: string) {
  const existing = loadActiveRoomSession();
  if (existing) saveActiveRoomSession(existing.roomCode, name, undefined);
}

export function clearActiveRoomSession() {
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(ACTIVE_ROOM_KEY);
}

export function recoveryFromSnapshot(snapshot: RoomSnapshot): RoomRecoveryState {
  const currentVideo = snapshot.currentVideo
    ? {
        ...snapshot.currentVideo,
        positionSec: Math.min(
          24 * 60 * 60,
          Math.max(0, snapshot.currentVideo.positionSec + (
            snapshot.currentVideo.state === "playing"
              ? Math.max(0, Date.now() - snapshot.currentVideo.changedAt) / 1000
              : 0
          )),
        ),
      }
    : null;
  return {
    currentVideo,
    queue: snapshot.queue.map((item) => ({
      videoId: item.videoId,
      title: item.title,
      channelTitle: item.channelTitle,
      thumbnailUrl: item.thumbnailUrl,
      addedByName: item.addedByName,
    })),
  };
}

function advanceRecovery(recovery: RoomRecoveryState, savedAt: number): RoomRecoveryState {
  if (!recovery.currentVideo || recovery.currentVideo.state !== "playing" || savedAt <= 0) {
    return recovery;
  }
  return {
    ...recovery,
    currentVideo: {
      ...recovery.currentVideo,
      positionSec: Math.min(
        24 * 60 * 60,
        Math.max(0, recovery.currentVideo.positionSec + Math.max(0, Date.now() - savedAt) / 1000),
      ),
    },
  };
}
