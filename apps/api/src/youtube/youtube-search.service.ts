import { Injectable } from "@nestjs/common";

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
}

interface YouTubeSearchResponse {
  items?: Array<{
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      channelTitle?: string;
      thumbnails?: Record<string, { url?: string }>;
    };
  }>;
  error?: { message?: string };
}

interface YouTubeVideoResponse {
  items?: Array<{
    snippet?: {
      title?: string;
      channelTitle?: string;
      categoryId?: string;
    };
  }>;
  error?: { message?: string };
}

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const CACHE_TTL_MS = 5 * 60 * 1000;
const SIMILAR_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;

@Injectable()
export class YouTubeSearchService {
  private readonly cache = new Map<
    string,
    { expiresAt: number; items: YouTubeSearchResult[] }
  >();
  private readonly similarCache = new Map<
    string,
    { expiresAt: number; items: YouTubeSearchResult[] }
  >();

  async search(input: string): Promise<YouTubeSearchResult[]> {
    const query = input.trim().replace(/\s+/g, " ");
    const cacheKey = query.toLocaleLowerCase("vi-VN");
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.items;

    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      videoEmbeddable: "true",
      safeSearch: "moderate",
      maxResults: "8",
      relevanceLanguage: "vi",
      q: query,
    });
    const payload = await this.request<YouTubeSearchResponse>("search", params);
    const items = mapSearchItems(payload.items);

    trimCache(this.cache);
    this.cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, items });
    return items;
  }

  async similar(input: string): Promise<YouTubeSearchResult[]> {
    const videoId = input.trim();
    if (!VIDEO_ID_PATTERN.test(videoId)) throw new Error("YOUTUBE_VIDEO_NOT_FOUND");

    const cached = this.similarCache.get(videoId);
    if (cached && cached.expiresAt > Date.now()) return cached.items;

    const videoParams = new URLSearchParams({
      part: "snippet",
      id: videoId,
    });
    const videoPayload = await this.request<YouTubeVideoResponse>("videos", videoParams);
    const source = videoPayload.items?.[0]?.snippet;
    if (!source?.title) throw new Error("YOUTUBE_VIDEO_NOT_FOUND");

    const searchParams = new URLSearchParams({
      part: "snippet",
      type: "video",
      videoEmbeddable: "true",
      videoSyndicated: "true",
      safeSearch: "moderate",
      maxResults: "12",
      relevanceLanguage: "vi",
      q: buildSimilarQuery(source.title),
    });
    if (source.categoryId) searchParams.set("videoCategoryId", source.categoryId);

    const searchPayload = await this.request<YouTubeSearchResponse>("search", searchParams);
    const items = mapSearchItems(searchPayload.items, new Set([videoId])).slice(0, 6);

    trimCache(this.similarCache);
    this.similarCache.set(videoId, {
      expiresAt: Date.now() + SIMILAR_CACHE_TTL_MS,
      items,
    });
    return items;
  }

  private async request<T extends { error?: { message?: string } }>(
    resource: "search" | "videos",
    params: URLSearchParams,
  ): Promise<T> {
    const apiKey = process.env.YOUTUBE_API_KEY?.trim();
    if (!apiKey) throw new Error("YOUTUBE_API_KEY_MISSING");
    params.set("key", apiKey);

    let response: Response;
    try {
      response = await fetch(`https://www.googleapis.com/youtube/v3/${resource}?${params}`, {
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new Error("YOUTUBE_SEARCH_UNAVAILABLE");
    }

    const payload = (await response.json().catch(() => ({}))) as T;
    if (!response.ok) {
      const message = payload.error?.message?.toLowerCase() ?? "";
      if (response.status === 403 && message.includes("quota")) {
        throw new Error("YOUTUBE_SEARCH_QUOTA");
      }
      throw new Error("YOUTUBE_SEARCH_UNAVAILABLE");
    }
    return payload;
  }
}

function mapSearchItems(
  source: YouTubeSearchResponse["items"] = [],
  excluded = new Set<string>(),
) {
  const seen = new Set(excluded);
  return source.flatMap<YouTubeSearchResult>((item) => {
    const videoId = item.id?.videoId;
    const snippet = item.snippet;
    const thumbnailUrl =
      snippet?.thumbnails?.medium?.url ??
      snippet?.thumbnails?.high?.url ??
      snippet?.thumbnails?.default?.url;
    if (
      !videoId ||
      seen.has(videoId) ||
      !VIDEO_ID_PATTERN.test(videoId) ||
      !snippet?.title ||
      !thumbnailUrl
    ) {
      return [];
    }
    seen.add(videoId);
    return [{
      videoId,
      title: decodeHtml(snippet.title),
      channelTitle: decodeHtml(snippet.channelTitle ?? "YouTube"),
      thumbnailUrl,
    }];
  });
}

function buildSimilarQuery(title: string) {
  const cleaned = decodeHtml(title)
    .replace(/[\[(](official (video|audio)|lyrics?|mv|4k)[\])]/gi, " ")
    .replace(/\b(official video|official audio|lyrics?|mv|4k)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || decodeHtml(title)).slice(0, 100);
}

function trimCache(cache: Map<string, unknown>) {
  if (cache.size < MAX_CACHE_ENTRIES) return;
  const oldestKey = cache.keys().next().value as string | undefined;
  if (oldestKey) cache.delete(oldestKey);
}

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
  };
  return value.replace(/&(#x?[0-9a-f]+|amp|apos|gt|lt|quot);/gi, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return safeCodePoint(Number.parseInt(entity.slice(2), 16), match);
    }
    if (entity.startsWith("#")) {
      return safeCodePoint(Number.parseInt(entity.slice(1), 10), match);
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function safeCodePoint(value: number, fallback: string) {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : fallback;
}
