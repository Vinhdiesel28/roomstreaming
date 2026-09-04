import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvidiousRecommendationService } from "./invidious-recommendation.service";

describe("InvidiousRecommendationService", () => {
  beforeEach(() => vi.stubEnv("INVIDIOUS_API_URL", "https://invidious.example/"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("is optional and does not fetch without configuration or with an invalid video ID", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const service = new InvidiousRecommendationService();
    expect(await service.recommendedVideoIds("invalid")).toEqual([]);
    vi.stubEnv("INVIDIOUS_API_URL", "");
    expect(service.configured()).toBe(false);
    expect(await service.recommendedVideoIds("source00000")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps valid unique IDs in order and caches/coalesces requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ recommendedVideos: [
        null, {}, { videoId: 123 }, { videoId: "bad" },
        { videoId: "source00000" }, { videoId: "bbbbbbbbbbb" },
        { videoId: "aaaaaaaaaaa" }, { videoId: "bbbbbbbbbbb" },
      ] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const service = new InvidiousRecommendationService();
    const results = await Promise.all([
      service.recommendedVideoIds("source00000"),
      service.recommendedVideoIds("source00000"),
    ]);
    expect(results).toEqual([["bbbbbbbbbbb", "aaaaaaaaaaa"], ["bbbbbbbbbbb", "aaaaaaaaaaa"]]);
    expect(await service.recommendedVideoIds("source00000")).toEqual(results[0]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0]![0]);
    expect(url.pathname).toBe("/api/v1/videos/source00000");
    expect(url.searchParams.get("fields")).toBe("recommendedVideos");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: "error" });
  });

  it.each(["http-error", "timeout", "html", "malformed"])(
    "falls back and backs off after %s, then retries",
    async (failure) => {
      vi.useFakeTimers();
      const fetchMock = vi.fn().mockImplementationOnce(async () => {
        if (failure === "timeout") throw new Error("timeout");
        return {
          ok: failure !== "http-error",
          json: async () => {
            if (failure === "html") throw new SyntaxError("HTML instead of JSON");
            return { recommendedVideos: "invalid" };
          },
        };
      }).mockResolvedValue({ ok: true, json: async () => ({ recommendedVideos: [] }) });
      vi.stubGlobal("fetch", fetchMock);
      const service = new InvidiousRecommendationService();
      expect(await service.recommendedVideoIds("source00000")).toEqual([]);
      expect(await service.recommendedVideoIds("different00")).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(60_001);
      expect(await service.recommendedVideoIds("source00000")).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("bounds the candidate pool", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ recommendedVideos: Array.from({ length: 100 }, (_, index) => ({
        videoId: String(index).padStart(11, "0"),
      })) }),
    }));
    expect(await new InvidiousRecommendationService().recommendedVideoIds("source00000"))
      .toHaveLength(40);
  });
});
