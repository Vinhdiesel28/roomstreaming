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

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;

@Injectable()
export class YouTubeSearchService {
  private readonly cache = new Map<
    string,
    { expiresAt: number; items: YouTubeSearchResult[] }
  >();

  async search(input: string): Promise<YouTubeSearchResult[]> {
    const query = input.trim().replace(/\s+/g, " ");
    const apiKey = process.env.YOUTUBE_API_KEY?.trim();
    if (!apiKey) throw new Error("YOUTUBE_API_KEY_MISSING");

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
      key: apiKey,
    });

    let response: Response;
    try {
      response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new Error("YOUTUBE_SEARCH_UNAVAILABLE");
    }

    const payload = (await response.json().catch(() => ({}))) as YouTubeSearchResponse;
    if (!response.ok) {
      const message = payload.error?.message?.toLowerCase() ?? "";
      if (response.status === 403 && message.includes("quota")) {
        throw new Error("YOUTUBE_SEARCH_QUOTA");
      }
      throw new Error("YOUTUBE_SEARCH_UNAVAILABLE");
    }

    const items = (payload.items ?? []).flatMap<YouTubeSearchResult>((item) => {
      const videoId = item.id?.videoId;
      const snippet = item.snippet;
      const thumbnailUrl =
        snippet?.thumbnails?.medium?.url ??
        snippet?.thumbnails?.high?.url ??
        snippet?.thumbnails?.default?.url;
      if (!videoId || !VIDEO_ID_PATTERN.test(videoId) || !snippet?.title || !thumbnailUrl) {
        return [];
      }
      return [{
        videoId,
        title: decodeHtml(snippet.title),
        channelTitle: decodeHtml(snippet.channelTitle ?? "YouTube"),
        thumbnailUrl,
      }];
    });

    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, items });
    return items;
  }
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
