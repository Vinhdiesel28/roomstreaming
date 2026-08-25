import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LastFmRecommendationService } from "../recommendation/lastfm-recommendation.service";
import {
  diversifyRecommendations,
  extractTrackIdentity,
  YouTubeSearchService,
} from "./youtube-search.service";

describe("YouTubeSearchService", () => {
  const originalKey = process.env.YOUTUBE_API_KEY;
  const originalLastFmKey = process.env.LASTFM_API_KEY;

  beforeEach(() => {
    delete process.env.LASTFM_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = originalKey;
    if (originalLastFmKey === undefined) delete process.env.LASTFM_API_KEY;
    else process.env.LASTFM_API_KEY = originalLastFmKey;
  });

  it("extracts artist and track names from common YouTube music titles", () => {
    expect(extractTrackIdentity("Da LAB - Gác Lại Âu Lo (Official MV)", "Da LAB Official"))
      .toEqual({ artist: "Da LAB", title: "Gác Lại Âu Lo" });
    expect(extractTrackIdentity("Chúng Ta Của Tương Lai [Official Audio]", "Sơn Tùng M-TP - Topic"))
      .toEqual({ artist: "Sơn Tùng M-TP", title: "Chúng Ta Của Tương Lai" });
  });

  it("interleaves artists and caps repeated artists in one recommendation batch", () => {
    const items = [
      result("aaaaaaaaaaa", "Ca sĩ A - Bài 1", "Ca sĩ A Official"),
      result("bbbbbbbbbbb", "Ca sĩ A - Bài 2", "Kênh đăng lại 1"),
      result("ccccccccccc", "Ca sĩ A - Bài 3", "Kênh đăng lại 2"),
      result("ddddddddddd", "Ca sĩ A - Bài 4", "Kênh đăng lại 3"),
      result("eeeeeeeeeee", "Ca sĩ B - Bài 1", "Ca sĩ B"),
      result("fffffffffff", "Ca sĩ B - Bài 2", "Ca sĩ B"),
      result("ggggggggggg", "Ca sĩ C - Bài 1", "Ca sĩ C"),
      result("hhhhhhhhhhh", "Ca sĩ D - Bài 1", "Ca sĩ D"),
      result("iiiiiiiiiii", "Ca sĩ D - Bài 2", "Ca sĩ D"),
    ];

    const diversified = diversifyRecommendations(items, "source00000", 8, "Ca sĩ A");
    const artists = diversified.map((item) => extractTrackIdentity(item.title, item.channelTitle).artist);

    expect(artists.slice(0, 4)).toEqual(["Ca sĩ B", "Ca sĩ C", "Ca sĩ D", "Ca sĩ A"]);
    expect(artists.filter((artist) => artist === "Ca sĩ A")).toHaveLength(3);
  });

  it("fills the batch from the remaining pool when only one artist is available", () => {
    const items = Array.from({ length: 8 }, (_, index) => result(
      `${index}`.padStart(11, "z"),
      `Ca sĩ A - Bài ${index + 1}`,
      "Ca sĩ A Official",
    ));

    expect(diversifyRecommendations(items, "source00000", 8, "Ca sĩ A")).toHaveLength(8);
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
            { contentDetails: { videoId: "ddddddddddd" } },
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
              id: "ddddddddddd",
              snippet: {
                title: "Video Shorts rất ngắn",
                channelTitle: "Ca sĩ",
                thumbnails: { medium: { url: "https://i.ytimg.com/short.jpg" } },
              },
              status: { embeddable: true, privacyStatus: "public" },
              contentDetails: { duration: "PT45S" },
            },
            {
              id: "ccccccccccc",
              snippet: {
                title: "Video mới thứ ba",
                channelTitle: "Ca sĩ",
                thumbnails: { medium: { url: "https://i.ytimg.com/third.jpg" } },
              },
              status: { embeddable: true, privacyStatus: "public" },
              contentDetails: { duration: "PT3M5S" },
            },
            {
              id: "aaaaaaaaaaa",
              snippet: {
                title: "Video mới nhất",
                channelTitle: "Ca sĩ",
                thumbnails: { medium: { url: "https://i.ytimg.com/latest.jpg" } },
              },
              status: { embeddable: true, privacyStatus: "public" },
              contentDetails: { duration: "PT3M30S" },
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
    const unseen = await service.similar("dQw4w9WgXcQ", [], [], ["aaaaaaaaaaa"]);
    const exhausted = await service.similar(
      "dQw4w9WgXcQ",
      [],
      [],
      ["aaaaaaaaaaa", "ccccccccccc"],
    );

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
    expect(unseen.map((item) => item.videoId)).toEqual(["ccccccccccc"]);
    expect(exhausted).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/videos?");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/channels?");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("part=contentDetails");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/playlistItems?");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("playlistId=uploads-1");
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain(
      "part=snippet%2Cstatus%2CcontentDetails",
    );
  });

  it("maps Last.fm tracks to playable YouTube videos and mixes a different artist first", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    const lastFm = {
      similarTracks: vi.fn(async () => [
        { artist: "Nghệ sĩ khác", title: "Bài khác", match: 0.91 },
      ]),
    } as unknown as LastFmRecommendationService;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [
          {
            id: "dQw4w9WgXcQ",
            snippet: {
              title: "Ca sĩ gốc - Bài gốc (Official MV)",
              channelTitle: "Ca sĩ gốc",
              channelId: "channel-1",
            },
          },
          {
            id: "9bZkp7q19f0",
            snippet: {
              title: "Ca sĩ trước - Bài vừa nghe",
              channelTitle: "Ca sĩ trước",
              channelId: "channel-2",
            },
          },
        ] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{
          contentDetails: { relatedPlaylists: { uploads: "uploads-1" } },
        }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [
          { contentDetails: { videoId: "ccccccccccc" } },
        ] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{
          id: "ccccccccccc",
          snippet: {
            title: "Bài mới cùng kênh",
            channelTitle: "Ca sĩ gốc",
            thumbnails: { medium: { url: "https://i.ytimg.com/same.jpg" } },
          },
          status: { embeddable: true, privacyStatus: "public" },
        }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [
          {
            id: { videoId: "aaaaaaaaaaa" },
            snippet: {
              title: "Nghệ sĩ khác - Bài khác",
              channelTitle: "Nghệ sĩ khác",
              thumbnails: { medium: { url: "https://i.ytimg.com/search.jpg" } },
            },
          },
          {
            id: { videoId: "bbbbbbbbbbb" },
            snippet: {
              title: "Nghệ sĩ khác - Bài khác (Lyrics)",
              channelTitle: "Kênh lyrics",
              thumbnails: { medium: { url: "https://i.ytimg.com/lyrics.jpg" } },
            },
          },
        ] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [
          {
            id: "bbbbbbbbbbb",
            snippet: {
              title: "Nghệ sĩ khác - Bài khác (Lyrics)",
              channelTitle: "Kênh lyrics",
              thumbnails: { medium: { url: "https://i.ytimg.com/lyrics.jpg" } },
            },
            status: { embeddable: true, privacyStatus: "public" },
            contentDetails: { duration: "PT4M10S" },
            statistics: { viewCount: "50000000" },
          },
          {
            id: "aaaaaaaaaaa",
            snippet: {
              title: "Nghệ sĩ khác - Bài khác (Official MV)",
              channelTitle: "Nghệ sĩ khácVEVO",
              thumbnails: { medium: { url: "https://i.ytimg.com/recommended.jpg" } },
            },
            status: { embeddable: true, privacyStatus: "public" },
            contentDetails: { duration: "PT4M12S" },
            statistics: { viewCount: "12000000" },
          },
        ] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const items = await new YouTubeSearchService(lastFm).similar(
      "dQw4w9WgXcQ",
      ["9bZkp7q19f0"],
      ["bbbbbbbbbbb"],
    );

    expect(lastFm.similarTracks).toHaveBeenCalledWith("Ca sĩ gốc", "Bài gốc", 8);
    expect(lastFm.similarTracks).toHaveBeenCalledWith("Ca sĩ trước", "Bài vừa nghe", 8);
    expect(items.map((item) => item.videoId)).toEqual(["aaaaaaaaaaa", "ccccccccccc"]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("dQw4w9WgXcQ%2C9bZkp7q19f0");
    expect(String(fetchMock.mock.calls[4]?.[0])).toContain("videoCategoryId=10");
    expect(String(fetchMock.mock.calls[5]?.[0])).toContain("contentDetails%2Cstatistics");
  });

  it("validates pasted videos before they enter the queue and caches valid IDs", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{
          id: "dQw4w9WgXcQ",
          snippet: {
            title: "Video thử nghiệm",
            channelTitle: "Kênh thử nghiệm",
            thumbnails: { medium: { url: "https://i.ytimg.com/test.jpg" } },
          },
          status: { embeddable: true, privacyStatus: "unlisted" },
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new YouTubeSearchService();
    const first = await service.ensurePlayable("dQw4w9WgXcQ");
    const cached = await service.ensurePlayable("dQw4w9WgXcQ");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("part=snippet%2Cstatus");
    expect(first.title).toBe("Video thử nghiệm");
    expect(cached).toEqual(first);
  });

  it("rejects private or non-embeddable pasted videos", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{
          id: "dQw4w9WgXcQ",
          snippet: {
            title: "Video bị chặn",
            channelTitle: "Kênh thử nghiệm",
            thumbnails: { medium: { url: "https://i.ytimg.com/test.jpg" } },
          },
          status: { embeddable: false, privacyStatus: "public" },
        }],
      }),
    }));

    await expect(new YouTubeSearchService().ensurePlayable("dQw4w9WgXcQ"))
      .rejects.toThrow("YOUTUBE_VIDEO_UNAVAILABLE");
  });
});

function result(videoId: string, title: string, channelTitle: string) {
  return {
    videoId,
    title,
    channelTitle,
    thumbnailUrl: `https://i.ytimg.com/${videoId}.jpg`,
  };
}
