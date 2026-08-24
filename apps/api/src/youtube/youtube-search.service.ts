import { Injectable } from "@nestjs/common";
import {
  LastFmRecommendationService,
  type SimilarTrack,
} from "../recommendation/lastfm-recommendation.service";

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
      tags?: string[];
      thumbnails?: Record<string, { url?: string }>;
    };
    status?: {
      embeddable?: boolean;
      privacyStatus?: string;
    };
    contentDetails?: { duration?: string };
    statistics?: { viewCount?: string };
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
const SIMILAR_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
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

  constructor(
    private readonly lastFm: LastFmRecommendationService = new LastFmRecommendationService(),
  ) {}

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
      part: "snippet,status",
      id: videoId,
    });
    const videoPayload = await this.request<YouTubeVideoResponse>("videos", videoParams);
    const source = videoPayload.items?.[0]?.snippet;
    if (!source?.channelId) throw new Error("YOUTUBE_VIDEO_NOT_FOUND");

    const identity = extractTrackIdentity(source.title ?? "", source.channelTitle ?? "");
    const channelId = source.channelId;
    const [sameChannel, similarTracks] = await Promise.all([
      this.loadSameChannel(channelId, videoId),
      this.lastFm.similarTracks(identity.artist, identity.title, 10),
    ]);
    const excluded = new Set([videoId, ...sameChannel.map((item) => item.videoId)]);
    const communityCandidates = similarTracks.length > 0
      ? await this.loadCommunityCandidates(similarTracks, excluded).catch(() => [])
      : [];
    return this.cacheSimilar(
      videoId,
      diversifyRecommendations([...communityCandidates, ...sameChannel], videoId),
    );
  }

  private async loadSameChannel(channelId: string, videoId: string) {
    const channelParams = new URLSearchParams({
      part: "contentDetails",
      id: channelId,
    });
    const channelPayload = await this.request<YouTubeChannelResponse>("channels", channelParams);
    const uploadsPlaylistId = channelPayload.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) return [];

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
    if (newestVideoIds.length === 0) return [];

    const latestParams = new URLSearchParams({
      part: "snippet,status",
      id: newestVideoIds.join(","),
    });
    const latestPayload = await this.request<YouTubeVideoResponse>("videos", latestParams);
    const availableById = new Map(
      mapVideoItems(latestPayload.items).map((item) => [item.videoId, item]),
    );
    return newestVideoIds.flatMap((id) => {
      const item = availableById.get(id);
      return item ? [item] : [];
    }).slice(0, 8);
  }

  private async loadCommunityCandidates(
    tracks: SimilarTrack[],
    excluded: Set<string>,
  ): Promise<YouTubeSearchResult[]> {
    const query = tracks
      .slice(0, 6)
      .map((track) => `"${track.artist} ${track.title}"`)
      .join(" | ");
    if (!query) return [];

    const searchParams = new URLSearchParams({
      part: "snippet",
      type: "video",
      videoEmbeddable: "true",
      safeSearch: "moderate",
      videoCategoryId: "10",
      maxResults: "25",
      relevanceLanguage: "vi",
      q: query,
    });
    const searchPayload = await this.request<YouTubeSearchResponse>("search", searchParams);
    const candidateIds = mapSearchItems(searchPayload.items, excluded)
      .map((item) => item.videoId)
      .slice(0, 25);
    if (candidateIds.length === 0) return [];

    const detailsParams = new URLSearchParams({
      part: "snippet,status,contentDetails,statistics",
      id: candidateIds.join(","),
    });
    const detailsPayload = await this.request<YouTubeVideoResponse>("videos", detailsParams);
    return rankCommunityCandidates(detailsPayload.items, tracks);
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

function rankCommunityCandidates(
  source: YouTubeVideoResponse["items"] = [],
  tracks: SimilarTrack[],
) {
  return source
    .flatMap<{ item: YouTubeSearchResult; score: number }>((raw) => {
      const item = mapVideoItems([raw])[0];
      if (!item) return [];
      const durationSec = parseDurationSeconds(raw.contentDetails?.duration);
      if (durationSec !== null && (durationSec < 60 || durationSec > 20 * 60)) return [];

      const candidateTitle = tokenSet(cleanMusicText(item.title));
      const candidateArtist = tokenSet(
        `${cleanChannelTitle(item.channelTitle)} ${cleanMusicText(item.title)}`,
      );
      const popularity = Math.min(1, Math.log10(Number(raw.statistics?.viewCount ?? 0) + 1) / 9);
      let bestScore = 0;
      let bestConfidence = 0;
      for (const track of tracks) {
        const titleCoverage = coverage(tokenSet(cleanMusicText(track.title)), candidateTitle);
        const artistCoverage = coverage(tokenSet(cleanChannelTitle(track.artist)), candidateArtist);
        const confidence = titleCoverage * 0.72 + artistCoverage * 0.28;
        const variantPenalty = unwantedVariantPenalty(item.title, track.title);
        const score = titleCoverage * 0.54
          + artistCoverage * 0.23
          + track.match * 0.15
          + popularity * 0.08
          - variantPenalty;
        if (score > bestScore) {
          bestScore = score;
          bestConfidence = confidence;
        }
      }
      return bestConfidence >= 0.52 ? [{ item, score: bestScore }] : [];
    })
    .sort((left, right) => right.score - left.score)
    .map(({ item }) => item);
}

export function extractTrackIdentity(rawTitle: string, rawChannel: string) {
  const title = cleanMusicText(decodeHtml(rawTitle));
  const pieces = title.split(/\s+(?:-|–|—|\|)\s+/).map((piece) => piece.trim()).filter(Boolean);
  if (pieces.length >= 2) {
    return { artist: pieces[0]!, title: pieces.slice(1).join(" - ") };
  }
  const artist = cleanChannelTitle(decodeHtml(rawChannel));
  const withoutArtist = title.replace(new RegExp(`^${escapeRegExp(artist)}\\s*[-–—|:]?\\s*`, "i"), "");
  return { artist, title: withoutArtist || title };
}

function diversifyRecommendations(items: YouTubeSearchResult[], excludedVideoId: string) {
  const unique: YouTubeSearchResult[] = [];
  const overflow: YouTubeSearchResult[] = [];
  const seen = new Set([excludedVideoId]);
  const channelCounts = new Map<string, number>();

  for (const item of items) {
    if (seen.has(item.videoId)) continue;
    seen.add(item.videoId);
    const channel = normalizeText(cleanChannelTitle(item.channelTitle));
    const count = channelCounts.get(channel) ?? 0;
    if (count >= 2) {
      overflow.push(item);
      continue;
    }
    channelCounts.set(channel, count + 1);
    unique.push(item);
    if (unique.length === 8) return unique;
  }

  for (const item of overflow) {
    unique.push(item);
    if (unique.length === 8) break;
  }
  return unique;
}

const MUSIC_NOISE = new Set([
  "official", "video", "audio", "lyrics", "lyric", "mv", "m", "v", "hd", "4k",
  "vietsub", "visualizer", "music", "records", "recordings",
]);

function cleanMusicText(value: string) {
  return value
    .replace(/[\[(](?:official|music video|official video|official audio|lyrics?|mv|hd|4k|visualizer)[^\])]*[\])]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanChannelTitle(value: string) {
  return value
    .replace(/\s+-\s+Topic$/i, "")
    .replace(/VEVO$/i, "")
    .trim();
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi-VN")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSet(value: string) {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((token) => token.length > 1 && !MUSIC_NOISE.has(token)),
  );
}

function coverage(expected: Set<string>, actual: Set<string>) {
  if (expected.size === 0) return 0;
  let matches = 0;
  for (const token of expected) {
    if (actual.has(token)) matches += 1;
  }
  return matches / expected.size;
}

function unwantedVariantPenalty(candidate: string, target: string) {
  const targetText = normalizeText(target);
  const candidateText = normalizeText(candidate);
  const variants = ["karaoke", "reaction", "cover", "nightcore", "sped up", "slowed"];
  return variants.some((variant) => candidateText.includes(variant) && !targetText.includes(variant))
    ? 0.22
    : 0;
}

function parseDurationSeconds(value?: string) {
  if (!value) return null;
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
