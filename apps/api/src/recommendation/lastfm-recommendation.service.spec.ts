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
});
