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

  it("updates the member name and avatar in room snapshots", () => {
    const room = store.create("host-session", "Minh");
    store.join(room.code, "host-session", "socket-1", "Minh");
    const avatarUrl = "data:image/png;base64,AAAA";

    store.updateProfile(room, "host-session", "Minh mới", avatarUrl);

    expect(store.snapshot(room, "host-session").members[0]).toMatchObject({
      name: "Minh mới",
      avatarUrl,
    });
  });

  it("keeps chat out of the room state and advances the queue", () => {
    const room = store.create("host", "Minh");
    store.join(room.code, "host", "socket-1", "Minh");
    store.addVideo(room, "host", video("dQw4w9WgXcQ", "Video đầu"));
    store.addVideo(room, "host", video("9bZkp7q19f0", "Video tiếp"));
    expect(room.currentVideo?.videoId).toBe("dQw4w9WgXcQ");
    expect(room.queue).toHaveLength(1);
    expect(room).not.toHaveProperty("messages");
    store.command(room, "host", "NEXT");
    expect(room.currentVideo?.videoId).toBe("9bZkp7q19f0");
    expect(room.queue).toHaveLength(0);
  });

  it("lets the host play any queued video immediately", () => {
    const room = store.create("host", "Minh");
    store.join(room.code, "host", "socket-1", "Minh");
    store.addVideo(room, "host", video("dQw4w9WgXcQ", "Video đầu"));
    store.addVideo(room, "host", video("aaaaaaaaaaa", "Video thứ hai"));
    store.addVideo(room, "host", video("bbbbbbbbbbb", "Video thứ ba"));

    const item = room.queue[1];
    expect(item).toBeDefined();
    store.playVideoNow(room, "host", item!.itemId);

    expect(room.currentVideo?.videoId).toBe("bbbbbbbbbbb");
    expect(room.currentVideo?.state).toBe("playing");
    expect(room.queue.map((queued) => queued.videoId)).toEqual(["aaaaaaaaaaa"]);
  });
});

function video(videoId: string, title: string) {
  return {
    videoId,
    title,
    channelTitle: "Kênh thử nghiệm",
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
  };
}
