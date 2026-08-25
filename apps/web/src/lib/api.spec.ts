// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { getSimilarYouTubeVideos } from "./api";

describe("YouTube API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests similar videos for the selected video id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{
          videoId: "aaaaaaaaaaa",
          title: "Video gợi ý",
          channelTitle: "Kênh",
          thumbnailUrl: "https://i.ytimg.com/suggestion.jpg",
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const items = await getSimilarYouTubeVideos("dQw4w9WgXcQ");

    expect(items).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/youtube/similar?videoId=dQw4w9WgXcQ",
    );
  });

  it("sends recent and skipped video context without exposing user data", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    await getSimilarYouTubeVideos(
      "dQw4w9WgXcQ",
      ["9bZkp7q19f0"],
      ["aaaaaaaaaaa"],
      ["bbbbbbbbbbb"],
    );

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("context=9bZkp7q19f0");
    expect(url).toContain("exclude=aaaaaaaaaaa");
    expect(url).toContain("seen=bbbbbbbbbbb");
  });

  it("keeps a longer exclusion list so suggestions do not cycle back too soon", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    const excludedVideoIds = Array.from(
      { length: 30 },
      (_, index) => index.toString().padStart(11, "a"),
    );

    await getSimilarYouTubeVideos("dQw4w9WgXcQ", [], excludedVideoIds);

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("exclude")?.split(",")).toHaveLength(30);
  });

  it("explains when Render is still running an old backend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: "Cannot GET /api/youtube/similar" }),
    }));

    await expect(getSimilarYouTubeVideos("dQw4w9WgXcQ")).rejects.toThrow(
      "Backend trên Render đang dùng phiên bản cũ",
    );
  });
});
