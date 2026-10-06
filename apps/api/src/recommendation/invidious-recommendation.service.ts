import { Injectable, Logger } from "@nestjs/common";

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const CACHE_TTL_MS = 30 * 60 * 1000;
const RETRY_DELAY_MS = 60_000;
const MAX_CACHE_ENTRIES = 100;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_INSTANCES = 3;

export interface RecommendationProviderHealth {
  configured: boolean;
  state: "disabled" | "idle" | "ok" | "degraded";
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
}

@Injectable()
export class InvidiousRecommendationService {
  private readonly logger = new Logger(InvidiousRecommendationService.name);
  private readonly cache = new Map<string, { expiresAt: number; ids: string[] }>();
  private readonly pending = new Map<string, Promise<string[]>>();
  private readonly retryAt = new Map<string, number>();
  private lastSuccessAt: number | null = null;
  private lastFailureAt: number | null = null;
  private lastError: string | null = null;

  configured() {
    return configuredInstances().length > 0;
  }

  health(): RecommendationProviderHealth {
    const configured = this.configured();
    return {
      configured,
      state: !configured
        ? "disabled"
        : this.lastSuccessAt !== null && (this.lastFailureAt === null || this.lastSuccessAt >= this.lastFailureAt)
          ? "ok"
          : this.lastFailureAt !== null
            ? "degraded"
            : "idle",
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt,
      lastError: this.lastError,
    };
  }

  async recommendedVideoIds(videoId: string): Promise<string[]> {
    const instances = configuredInstances();
    if (instances.length === 0 || !VIDEO_ID_PATTERN.test(videoId)) return [];
    const key = `${instances.join(",")}\u0000${videoId}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.ids;
    const pending = this.pending.get(key);
    if (pending) return pending;

    const request = this.load(instances, videoId)
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
      .catch((error: unknown) => {
        const code = providerErrorCode(error);
        this.lastFailureAt = Date.now();
        this.lastError = code;
        this.logger.warn(`Invidious unavailable (${code}); using other recommendation sources.`);
        return [];
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  private async load(instances: string[], videoId: string): Promise<string[]> {
    let lastError: unknown = new Error("INVIDIOUS_UNAVAILABLE");
    for (const base of instances) {
      if ((this.retryAt.get(base) ?? 0) > Date.now()) continue;
      try {
        const ids = await this.loadFromInstance(base, videoId);
        if (ids.length === 0) throw new Error("INVIDIOUS_EMPTY_RECOMMENDATIONS");
        this.retryAt.delete(base);
        this.lastSuccessAt = Date.now();
        this.lastError = null;
        return ids;
      } catch (error) {
        lastError = error;
        this.retryAt.set(base, Date.now() + RETRY_DELAY_MS);
        this.lastFailureAt = Date.now();
        this.lastError = providerErrorCode(error);
      }
    }
    throw lastError;
  }

  private async loadFromInstance(base: string, videoId: string): Promise<string[]> {
    // Only the server operator configures these URLs; never accept an instance URL from clients.
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`INVIDIOUS_HTTP_${response.status}`);
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

function configuredInstances() {
  const raw = process.env.INVIDIOUS_API_URL?.trim() ?? "";
  const seen = new Set<string>();
  return raw.split(",").flatMap((value) => {
    const candidate = value.trim().replace(/\/+$/, "");
    if (!candidate || seen.has(candidate)) return [];
    seen.add(candidate);
    return [candidate];
  }).slice(0, MAX_INSTANCES);
}

function providerErrorCode(error: unknown) {
  if (error instanceof DOMException && error.name === "TimeoutError") return "INVIDIOUS_TIMEOUT";
  if (error instanceof Error) return error.message.slice(0, 80);
  return "INVIDIOUS_UNAVAILABLE";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
