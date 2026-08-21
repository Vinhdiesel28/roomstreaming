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
});
