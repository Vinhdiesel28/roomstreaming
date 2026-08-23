// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomSnapshot } from "../types";
import {
  clearActiveRoomSession,
  loadActiveRoomSession,
  recoveryFromSnapshot,
  saveActiveRoomSession,
  updateActiveRoomName,
} from "./roomSession";

describe("active room session", () => {
  beforeEach(() => sessionStorage.clear());

  it("stores the room code and display name for the current tab", () => {
    saveActiveRoomSession("ABCD2345", "Vinh");
    expect(loadActiveRoomSession("ABCD2345")).toMatchObject({ roomCode: "ABCD2345", name: "Vinh" });
    expect(loadActiveRoomSession("WXYZ6789")).toBeNull();
  });

  it("updates the saved name and clears the session on leave", () => {
    saveActiveRoomSession("ABCD2345", "Vinh");
    updateActiveRoomName("Vinh mới");
    expect(loadActiveRoomSession()?.name).toBe("Vinh mới");
    clearActiveRoomSession();
    expect(loadActiveRoomSession()).toBeNull();
  });

  it("advances a playing video position when caching recovery state", () => {
    vi.spyOn(Date, "now").mockReturnValue(11_000);
    const recovery = recoveryFromSnapshot({
      roomCode: "ABCD2345",
      hostSessionId: "host",
      isHost: true,
      currentVideo: {
        videoId: "dQw4w9WgXcQ",
        state: "playing",
        positionSec: 20,
        changedAt: 6_000,
        version: 1,
      },
      queue: [],
      queueVersion: 0,
      members: [],
      serverTime: 11_000,
    } satisfies RoomSnapshot);
    expect(recovery.currentVideo?.positionSec).toBe(25);
    vi.restoreAllMocks();
  });

  it("advances cached playback while the backend is asleep", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    saveActiveRoomSession("ABCD2345", "Vinh", {
      roomCode: "ABCD2345",
      hostSessionId: "host",
      isHost: true,
      currentVideo: {
        videoId: "dQw4w9WgXcQ",
        state: "playing",
        positionSec: 10,
        changedAt: 1_000,
        version: 1,
      },
      queue: [],
      queueVersion: 0,
      members: [],
      serverTime: 1_000,
    });
    now.mockReturnValue(6_000);
    expect(loadActiveRoomSession()?.recovery?.currentVideo?.positionSec).toBe(15);
    vi.restoreAllMocks();
  });
});
