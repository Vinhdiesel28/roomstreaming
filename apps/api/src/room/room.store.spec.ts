import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RoomStore } from "./room.store";

describe("RoomStore", () => {
  let store: RoomStore;

  beforeEach(() => {
    store = new RoomStore();
  });

  afterEach(() => store.onModuleDestroy());

  it("creates a unique eight-character room and restores host identity on join", () => {
    const room = store.create("host-session", "Minh");
    store.join(room.code, "host-session", "socket-1", "Minh");
    expect(room.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(store.snapshot(room, "host-session").isHost).toBe(true);
  });

  it("keeps chat out of the room state and advances the queue", () => {
    const room = store.create("host", "Minh");
    store.join(room.code, "host", "socket-1", "Minh");
    store.addVideo(room, "host", "dQw4w9WgXcQ");
    store.addVideo(room, "host", "9bZkp7q19f0");
    expect(room.currentVideo?.videoId).toBe("dQw4w9WgXcQ");
    expect(room.queue).toHaveLength(1);
    expect(room).not.toHaveProperty("messages");
    store.command(room, "host", "NEXT");
    expect(room.currentVideo?.videoId).toBe("9bZkp7q19f0");
    expect(room.queue).toHaveLength(0);
  });
});
