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

  it("finds similar embeddable videos and caches them by source video", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [{
            snippet: {
              title: "Một bài hát (Official Video)",
              channelTitle: "Ca sĩ",
              categoryId: "10",
            },
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: { videoId: "dQw4w9WgXcQ" },
              snippet: {
                title: "Video hiện tại",
                channelTitle: "Ca sĩ",
                thumbnails: { medium: { url: "https://i.ytimg.com/current.jpg" } },
              },
            },
            {
              id: { videoId: "aaaaaaaaaaa" },
              snippet: {
                title: "Bài hát tiếp theo",
                channelTitle: "Ca sĩ khác",
                thumbnails: { medium: { url: "https://i.ytimg.com/next.jpg" } },
              },
            },
            {
              id: { videoId: "aaaaaaaaaaa" },
              snippet: {
                title: "Kết quả trùng",
                channelTitle: "Ca sĩ khác",
                thumbnails: { medium: { url: "https://i.ytimg.com/duplicate.jpg" } },
              },
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const service = new YouTubeSearchService();
    const first = await service.similar("dQw4w9WgXcQ");
    const second = await service.similar("dQw4w9WgXcQ");

    expect(first).toEqual([{
      videoId: "aaaaaaaaaaa",
      title: "Bài hát tiếp theo",
      channelTitle: "Ca sĩ khác",
      thumbnailUrl: "https://i.ytimg.com/next.jpg",
    }]);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/videos?");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("videoSyndicated=true");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("videoCategoryId=10");
    expect(String(fetchMock.mock.calls[1]?.[0])).not.toContain("Official+Video");
  });
});
