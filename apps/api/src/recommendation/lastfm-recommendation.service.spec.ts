import { afterEach, describe, expect, it, vi } from "vitest";
import { LastFmRecommendationService } from "./lastfm-recommendation.service";

describe("LastFmRecommendationService", () => {
  const originalKey = process.env.LASTFM_API_KEY;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.LASTFM_API_KEY;
    else process.env.LASTFM_API_KEY = originalKey;
  });

  it("degrades to no external candidates when no API key is configured", async () => {
    delete process.env.LASTFM_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(new LastFmRecommendationService().similarTracks("Da LAB", "Gác lại âu lo"))
      .resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps, clamps and deduplicates similar tracks", async () => {
    process.env.LASTFM_API_KEY = "lastfm-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        similartracks: {
          track: [
            { name: "Bài mới", match: "1.4", artist: { name: "Ca sĩ" } },
            { name: "Bài mới", match: "0.8", artist: { name: "Ca sĩ" } },
            { name: "Bài khác", match: "0.72", artist: { name: "Nghệ sĩ khác" } },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new LastFmRecommendationService();
    const first = await service.similarTracks("Da LAB", "Gác lại âu lo");
    const cached = await service.similarTracks("Da LAB", "Gác lại âu lo");

    expect(first).toEqual([
      { artist: "Ca sĩ", title: "Bài mới", match: 1 },
      { artist: "Nghệ sĩ khác", title: "Bài khác", match: 0.72 },
    ]);
    expect(cached).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("method=track.getsimilar");
  });

  it("discovers top tracks from similar artists when track-level data is sparse", async () => {
    process.env.LASTFM_API_KEY = "lastfm-key";
    const fetchMock = vi.fn().mockImplementation(async (input: string) => {
      const url = new URL(input);
      if (url.searchParams.get("method") === "artist.getsimilar") {
        return { ok: true, status: 200, json: async () => ({ similarartists: { artist: [
          { name: "Cá Hồi Hoang", match: "0.8" },
          { name: "Thịnh Suy", match: "0.6" },
        ] } }) };
      }
      const artist = url.searchParams.get("artist");
      return { ok: true, status: 200, json: async () => ({ toptracks: { track: [
        { name: `${artist} bài 1` }, { name: `${artist} bài 2` }, { name: `${artist} bài 3` },
      ] } }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new LastFmRecommendationService();
    const tracks = await service.artistDiscoveryTracks("Ngọt", 10);
    expect(tracks.map((track) => `${track.artist} - ${track.title}`)).toEqual([
      "Cá Hồi Hoang - Cá Hồi Hoang bài 1",
      "Cá Hồi Hoang - Cá Hồi Hoang bài 2",
      "Thịnh Suy - Thịnh Suy bài 1",
      "Thịnh Suy - Thịnh Suy bài 2",
    ]);
    expect(await service.artistDiscoveryTracks("Ngọt", 10)).toEqual(tracks);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
