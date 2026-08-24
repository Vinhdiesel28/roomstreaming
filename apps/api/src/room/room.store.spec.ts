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

  it("recreates the same room code and media state after a server restart", () => {
    const result = store.resume(
      "ABCD2345",
      "returning-session",
      "socket-1",
      "Minh",
      null,
      {
        currentVideo: { videoId: "dQw4w9WgXcQ", state: "playing", positionSec: 42 },
        queue: [{
          videoId: "9bZkp7q19f0",
          title: "Video tiếp",
          channelTitle: "Kênh thử nghiệm",
          thumbnailUrl: "https://i.ytimg.com/vi/9bZkp7q19f0/mqdefault.jpg",
          addedByName: "Minh",
        }],
      },
    );

    const snapshot = store.snapshot(result.room, "returning-session");
    expect(result.recovered).toBe(true);
    expect(snapshot.roomCode).toBe("ABCD2345");
    expect(snapshot.isHost).toBe(true);
    expect(snapshot.currentVideo).toMatchObject({ videoId: "dQw4w9WgXcQ", positionSec: 42 });
    expect(snapshot.queue[0]).toMatchObject({ videoId: "9bZkp7q19f0", title: "Video tiếp" });
  });

  it("joins an existing room without overwriting its current state", () => {
    const room = store.create("host", "Host");
    store.join(room.code, "host", "socket-host", "Host");
    store.addVideo(room, "host", video("dQw4w9WgXcQ", "Video đang chạy"));

    const result = store.resume(room.code, "guest", "socket-guest", "Khách", null, {
      currentVideo: null,
      queue: [],
    });

    expect(result.recovered).toBe(false);
    expect(store.snapshot(room, "guest").currentVideo?.videoId).toBe("dQw4w9WgXcQ");
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
    expect(room.recentVideoIds).toEqual(["dQw4w9WgXcQ"]);
    expect(room.skippedVideoIds).toEqual([]);

    store.command(room, "host", "NEXT", -1);
    expect(room.currentVideo).toBeNull();
    expect(room.recentVideoIds).toEqual(["9bZkp7q19f0", "dQw4w9WgXcQ"]);
    expect(room.skippedVideoIds).toEqual(["9bZkp7q19f0"]);
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
    expect(room.recentVideoIds).toEqual(["dQw4w9WgXcQ"]);
  });

  it("keeps plus-button videos queued and lets only the host play a result directly", () => {
    const room = store.create("host", "Minh");
    store.join(room.code, "host", "socket-host", "Minh");
    store.join(room.code, "guest", "socket-guest", "Bạn", null);
    const queued = video("aaaaaaaaaaa", "Video từ nút cộng");

    store.addVideo(room, "guest", queued, true);
    expect(room.currentVideo).toBeNull();
    expect(room.queue.map((item) => item.videoId)).toEqual(["aaaaaaaaaaa"]);
    expect(() => store.playVideoDirectly(room, "guest", queued)).toThrow("HOST_ONLY");

    store.playVideoDirectly(room, "host", queued);
    expect(room.currentVideo).toMatchObject({ videoId: "aaaaaaaaaaa", state: "playing" });
    expect(room.queue).toEqual([]);
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
