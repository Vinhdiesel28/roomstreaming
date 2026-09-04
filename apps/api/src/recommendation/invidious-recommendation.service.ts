import { Injectable, Logger } from "@nestjs/common";

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const CACHE_TTL_MS = 30 * 60 * 1000;
const RETRY_DELAY_MS = 60_000;
const MAX_CACHE_ENTRIES = 100;

@Injectable()
export class InvidiousRecommendationService {
  private readonly logger = new Logger(InvidiousRecommendationService.name);
  private readonly cache = new Map<string, { expiresAt: number; ids: string[] }>();
  private readonly pending = new Map<string, Promise<string[]>>();
  private retryAt = 0;

  configured() {
    return Boolean(process.env.INVIDIOUS_API_URL?.trim());
  }

  async recommendedVideoIds(videoId: string): Promise<string[]> {
    const base = process.env.INVIDIOUS_API_URL?.trim();
    if (!base || !VIDEO_ID_PATTERN.test(videoId)) return [];
    const key = `${base}\u0000${videoId}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.ids;
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (Date.now() < this.retryAt) return [];

    const request = this.load(base, videoId)
      .then((ids) => {
        if (this.cache.size >= MAX_CACHE_ENTRIES) {
          const oldest = this.cache.keys().next().value;
          if (oldest !== undefined) this.cache.delete(oldest);
        }
        this.cache.set(key, {
          expiresAt: Date.now() + (ids.length ? CACHE_TTL_MS : RETRY_DELAY_MS),
          ids,
        });
        return ids;
      })
      .catch(() => {
        if (Date.now() >= this.retryAt) {
          this.logger.warn("Invidious unavailable; using existing recommendation sources for 60 seconds.");
        }
        this.retryAt = Date.now() + RETRY_DELAY_MS;
        return [];
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  private async load(base: string, videoId: string): Promise<string[]> {
    // Only the server operator configures this URL; never accept an instance URL from clients.
    const url = new URL(base);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password
      || url.search || url.hash) throw new Error("INVALID_INVIDIOUS_API_URL");
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/v1/videos/${videoId}`;
    url.searchParams.set("fields", "recommendedVideos");
    url.searchParams.set("hl", "vi");
    url.searchParams.set("region", "VN");

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error("INVIDIOUS_UNAVAILABLE");
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.recommendedVideos)) {
      throw new Error("INVALID_INVIDIOUS_RESPONSE");
    }

    const seen = new Set([videoId]);
    const ids: string[] = [];
    for (const item of payload.recommendedVideos.slice(0, 100)) {
      if (!isRecord(item) || typeof item.videoId !== "string"
        || !VIDEO_ID_PATTERN.test(item.videoId) || seen.has(item.videoId)) continue;
      seen.add(item.videoId);
      // Metadata and embed permissions are verified against YouTube before display.
      ids.push(item.videoId);
      if (ids.length === 40) break;
    }
    return ids;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
