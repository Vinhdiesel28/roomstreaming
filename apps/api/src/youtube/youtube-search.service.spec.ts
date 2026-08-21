import { afterEach, describe, expect, it, vi } from "vitest";
import { YouTubeSearchService } from "./youtube-search.service";

describe("YouTubeSearchService", () => {
  const originalKey = process.env.YOUTUBE_API_KEY;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = originalKey;
  });

  it("requires a server-side API key", async () => {
    delete process.env.YOUTUBE_API_KEY;
    await expect(new YouTubeSearchService().search("lofi")).rejects.toThrow(
      "YOUTUBE_API_KEY_MISSING",
    );
  });

  it("maps embeddable search results and caches repeated queries", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{
          id: { videoId: "dQw4w9WgXcQ" },
          snippet: {
            title: "Rock &amp; Roll",
            channelTitle: "Test channel",
            thumbnails: { medium: { url: "https://i.ytimg.com/test.jpg" } },
          },
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new YouTubeSearchService();
    const first = await service.search("  rock   roll ");
    const second = await service.search("rock roll");

    expect(first).toEqual([{
      videoId: "dQw4w9WgXcQ",
      title: "Rock & Roll",
      channelTitle: "Test channel",
      thumbnailUrl: "https://i.ytimg.com/test.jpg",
    }]);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("videoEmbeddable=true");
  });
});
