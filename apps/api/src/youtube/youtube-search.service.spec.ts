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

  it("returns the newest embeddable uploads from the source channel in playlist order", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [{
            snippet: {
              title: "Video hiện tại",
              channelTitle: "Ca sĩ",
              channelId: "channel-1",
            },
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [{ contentDetails: { relatedPlaylists: { uploads: "uploads-1" } } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            { contentDetails: { videoId: "dQw4w9WgXcQ" } },
            { contentDetails: { videoId: "aaaaaaaaaaa" } },
            { contentDetails: { videoId: "bbbbbbbbbbb" } },
            { contentDetails: { videoId: "ccccccccccc" } },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: "ccccccccccc",
              snippet: {
                title: "Video mới thứ ba",
                channelTitle: "Ca sĩ",
                thumbnails: { medium: { url: "https://i.ytimg.com/third.jpg" } },
              },
              status: { embeddable: true, privacyStatus: "public" },
            },
            {
              id: "aaaaaaaaaaa",
              snippet: {
                title: "Video mới nhất",
                channelTitle: "Ca sĩ",
                thumbnails: { medium: { url: "https://i.ytimg.com/latest.jpg" } },
              },
              status: { embeddable: true, privacyStatus: "public" },
            },
            {
              id: "bbbbbbbbbbb",
              snippet: {
                title: "Video không cho nhúng",
                channelTitle: "Ca sĩ",
                thumbnails: { medium: { url: "https://i.ytimg.com/blocked.jpg" } },
              },
              status: { embeddable: false, privacyStatus: "public" },
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const service = new YouTubeSearchService();
    const [first, simultaneous] = await Promise.all([
      service.similar("dQw4w9WgXcQ"),
      service.similar("dQw4w9WgXcQ"),
    ]);
    const cached = await service.similar("dQw4w9WgXcQ");

    expect(first).toEqual([
      {
        videoId: "aaaaaaaaaaa",
        title: "Video mới nhất",
        channelTitle: "Ca sĩ",
        thumbnailUrl: "https://i.ytimg.com/latest.jpg",
      },
      {
        videoId: "ccccccccccc",
        title: "Video mới thứ ba",
        channelTitle: "Ca sĩ",
        thumbnailUrl: "https://i.ytimg.com/third.jpg",
      },
    ]);
    expect(simultaneous).toEqual(first);
    expect(cached).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/videos?");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/channels?");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("part=contentDetails");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/playlistItems?");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("playlistId=uploads-1");
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain("part=snippet%2Cstatus");
  });

  it("validates pasted videos before they enter the queue and caches valid IDs", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{ status: { embeddable: true, privacyStatus: "unlisted" } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new YouTubeSearchService();
    await service.ensurePlayable("dQw4w9WgXcQ");
    await service.ensurePlayable("dQw4w9WgXcQ");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("part=status");
  });

  it("rejects private or non-embeddable pasted videos", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{ status: { embeddable: false, privacyStatus: "public" } }],
      }),
    }));

    await expect(new YouTubeSearchService().ensurePlayable("dQw4w9WgXcQ"))
      .rejects.toThrow("YOUTUBE_VIDEO_UNAVAILABLE");
  });
});
