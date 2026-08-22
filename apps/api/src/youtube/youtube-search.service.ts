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
    id?: string;
    snippet?: {
      title?: string;
      channelTitle?: string;
      channelId?: string;
      thumbnails?: Record<string, { url?: string }>;
    };
    status?: {
      embeddable?: boolean;
      privacyStatus?: string;
    };
  }>;
  error?: { message?: string };
}

interface YouTubeChannelResponse {
  items?: Array<{
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }>;
  error?: { message?: string };
}

interface YouTubePlaylistItemsResponse {
  items?: Array<{ contentDetails?: { videoId?: string } }>;
  error?: { message?: string };
}

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const CACHE_TTL_MS = 5 * 60 * 1000;
const SIMILAR_CACHE_TTL_MS = 15 * 60 * 1000;
const PLAYABLE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
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
  private readonly similarPending = new Map<string, Promise<YouTubeSearchResult[]>>();
  private readonly playableCache = new Map<
    string,
    { expiresAt: number; item: YouTubeSearchResult }
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

    const pending = this.similarPending.get(videoId);
    if (pending) return pending;

    const request = this.loadSimilar(videoId).finally(() => {
      if (this.similarPending.get(videoId) === request) {
        this.similarPending.delete(videoId);
      }
    });
    this.similarPending.set(videoId, request);
    return request;
  }

  async ensurePlayable(input: string): Promise<YouTubeSearchResult> {
    const videoId = input.trim();
    if (!VIDEO_ID_PATTERN.test(videoId)) throw new Error("YOUTUBE_VIDEO_UNAVAILABLE");
    const cached = this.playableCache.get(videoId);
    if (cached && cached.expiresAt > Date.now()) return cached.item;

    const params = new URLSearchParams({ part: "snippet,status", id: videoId });
    const payload = await this.request<YouTubeVideoResponse>("videos", params);
    const item = mapVideoItems(payload.items)[0];
    if (!item) throw new Error("YOUTUBE_VIDEO_UNAVAILABLE");
    trimCache(this.playableCache);
    this.playableCache.set(videoId, {
      expiresAt: Date.now() + PLAYABLE_CACHE_TTL_MS,
      item,
    });
    return item;
  }

  private async loadSimilar(videoId: string): Promise<YouTubeSearchResult[]> {
    const videoParams = new URLSearchParams({
      part: "snippet",
      id: videoId,
    });
    const videoPayload = await this.request<YouTubeVideoResponse>("videos", videoParams);
    const source = videoPayload.items?.[0]?.snippet;
    if (!source?.channelId) throw new Error("YOUTUBE_VIDEO_NOT_FOUND");

    const channelParams = new URLSearchParams({
      part: "contentDetails",
      id: source.channelId,
    });
    const channelPayload = await this.request<YouTubeChannelResponse>("channels", channelParams);
    const uploadsPlaylistId = channelPayload.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) return this.cacheSimilar(videoId, []);

    const playlistParams = new URLSearchParams({
      part: "contentDetails",
      playlistId: uploadsPlaylistId,
      maxResults: "16",
    });
    const playlistPayload = await this.request<YouTubePlaylistItemsResponse>(
      "playlistItems",
      playlistParams,
    );
    const seen = new Set([videoId]);
    const newestVideoIds = (playlistPayload.items ?? []).flatMap((item) => {
      const candidateId = item.contentDetails?.videoId;
      if (!candidateId || !VIDEO_ID_PATTERN.test(candidateId) || seen.has(candidateId)) return [];
      seen.add(candidateId);
      return [candidateId];
    });
    if (newestVideoIds.length === 0) return this.cacheSimilar(videoId, []);

    const latestParams = new URLSearchParams({
      part: "snippet,status",
      id: newestVideoIds.join(","),
    });
    const latestPayload = await this.request<YouTubeVideoResponse>("videos", latestParams);
    const availableById = new Map(
      mapVideoItems(latestPayload.items).map((item) => [item.videoId, item]),
    );
    const items = newestVideoIds.flatMap((id) => {
      const item = availableById.get(id);
      return item ? [item] : [];
    }).slice(0, 8);

    return this.cacheSimilar(videoId, items);
  }

  private cacheSimilar(videoId: string, items: YouTubeSearchResult[]) {
    trimCache(this.similarCache);
    this.similarCache.set(videoId, {
      expiresAt: Date.now() + SIMILAR_CACHE_TTL_MS,
      items,
    });
    return items;
  }

  private async request<T extends { error?: { message?: string } }>(
    resource: "search" | "videos" | "channels" | "playlistItems",
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

function mapVideoItems(source: YouTubeVideoResponse["items"] = []) {
  return source.flatMap<YouTubeSearchResult>((item) => {
    const videoId = item.id;
    const snippet = item.snippet;
    const thumbnailUrl =
      snippet?.thumbnails?.medium?.url ??
      snippet?.thumbnails?.high?.url ??
      snippet?.thumbnails?.default?.url;
    if (
      !videoId ||
      !VIDEO_ID_PATTERN.test(videoId) ||
      !snippet?.title ||
      !thumbnailUrl ||
      !item.status?.embeddable ||
      item.status.privacyStatus === "private"
    ) {
      return [];
    }
    return [{
      videoId,
      title: decodeHtml(snippet.title),
      channelTitle: decodeHtml(snippet.channelTitle ?? "YouTube"),
      thumbnailUrl,
    }];
  });
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
