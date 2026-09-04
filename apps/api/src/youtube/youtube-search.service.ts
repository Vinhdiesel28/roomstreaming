import { Injectable } from "@nestjs/common";
import { InvidiousRecommendationService } from "../recommendation/invidious-recommendation.service";
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
const MAX_RECOMMENDATION_EXCLUSIONS = 100;
const MAX_SEEN_RECOMMENDATIONS = 60;
const MIN_RECOMMENDATION_DURATION_SEC = 90;
const MAX_RECOMMENDATION_DURATION_SEC = 20 * 60;

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
    private readonly invidious: InvidiousRecommendationService = new InvidiousRecommendationService(),
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

  async similar(
    input: string,
    contextInput: string[] = [],
    excludedInput: string[] = [],
    seenInput: string[] = [],
  ): Promise<YouTubeSearchResult[]> {
    const videoId = input.trim();
    if (!VIDEO_ID_PATTERN.test(videoId)) throw new Error("YOUTUBE_VIDEO_NOT_FOUND");
    const contextVideoIds = validUniqueVideoIds(contextInput, new Set([videoId])).slice(0, 4);
    const excludedVideoIds = new Set(
      validUniqueVideoIds(excludedInput).slice(0, MAX_RECOMMENDATION_EXCLUSIONS),
    );
    const seenVideoIds = new Set(
      validUniqueVideoIds(seenInput).slice(0, MAX_SEEN_RECOMMENDATIONS),
    );
    const cacheKey = [process.env.INVIDIOUS_API_URL?.trim() ?? "", videoId, ...contextVideoIds].join(":");

    const cached = this.similarCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return selectRecommendations(cached.items, excludedVideoIds, seenVideoIds);
    }

    const pending = this.similarPending.get(cacheKey);
    if (pending) {
      return selectRecommendations(await pending, excludedVideoIds, seenVideoIds);
    }

    const request = this.loadSimilar(videoId, contextVideoIds, cacheKey).finally(() => {
      if (this.similarPending.get(cacheKey) === request) {
        this.similarPending.delete(cacheKey);
      }
    });
    this.similarPending.set(cacheKey, request);
    return selectRecommendations(await request, excludedVideoIds, seenVideoIds);
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

  private async loadSimilar(
    videoId: string,
    contextVideoIds: string[],
    cacheKey: string,
  ): Promise<YouTubeSearchResult[]> {
    const videoParams = new URLSearchParams({
      part: "snippet,status",
      id: [videoId, ...contextVideoIds].join(","),
    });
    const [videoPayload, invidiousIds] = await Promise.all([
      this.request<YouTubeVideoResponse>("videos", videoParams),
      this.invidious.recommendedVideoIds(videoId).catch(() => [] as string[]),
    ]);
    const sourceItem = videoPayload.items?.find((item) => item.id === videoId)
      ?? videoPayload.items?.[0];
    const source = sourceItem?.snippet;
    if (!source?.channelId) throw new Error("YOUTUBE_VIDEO_NOT_FOUND");
    const sourceArtist = extractTrackIdentity(
      source.title ?? "",
      source.channelTitle ?? "",
    ).artist;

    const identities = [source, ...(videoPayload.items ?? [])
      .filter((item) => item !== sourceItem && item.id !== videoId)
      .map((item) => item.snippet)
      .filter((snippet): snippet is NonNullable<typeof snippet> => Boolean(snippet))]
      .map((snippet) => extractTrackIdentity(snippet.title ?? "", snippet.channelTitle ?? ""))
      .filter((identity) => identity.artist && identity.title)
      .slice(0, 5);
    const channelId = source.channelId;
    const [invidiousCandidates, sameChannel, similarGroups] = await Promise.all([
      this.loadVerifiedRecommendations(invidiousIds).catch(() => [] as YouTubeSearchResult[]),
      this.loadSameChannel(channelId, videoId).catch(() => [] as YouTubeSearchResult[]),
      Promise.all(identities.map((identity) =>
        this.lastFm.similarTracks(identity.artist, identity.title, 8).catch(() => [] as SimilarTrack[]))),
    ]);
    const similarTracks = blendSimilarTrackGroups(similarGroups);
    const excluded = new Set([videoId, ...sameChannel.map((item) => item.videoId)]);
    const communityCandidates = similarTracks.length > 0
      ? await this.loadCommunityCandidates(similarTracks, excluded).catch(() => [])
      : [];
    return this.cacheSimilar(
      cacheKey,
      diversifyRecommendations(
        [...invidiousCandidates, ...communityCandidates, ...sameChannel],
        videoId,
        24,
        sourceArtist,
      ),
      // Retry a failed/empty optional provider soon, not after the normal six-hour cache.
      this.invidious.configured()
        ? (invidiousCandidates.length ? 30 * 60 * 1000 : 60_000)
        : SIMILAR_CACHE_TTL_MS,
    );
  }

  private async loadVerifiedRecommendations(ids: string[]): Promise<YouTubeSearchResult[]> {
    if (ids.length === 0) return [];
    const payload = await this.request<YouTubeVideoResponse>("videos", new URLSearchParams({
      part: "snippet,status,contentDetails",
      id: ids.join(","),
    }));
    const byId = new Map((payload.items ?? []).flatMap((raw) => {
      const item = mapVideoItems([raw])[0];
      const duration = parseDurationSeconds(raw.contentDetails?.duration);
      return item && duration !== null && isRecommendationDuration(duration)
        ? [[item.videoId, item] as const]
        : [];
    }));
    // Preserve Invidious relevance order even if YouTube returns details in another order.
    return ids.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
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
      maxResults: "25",
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
      part: "snippet,status,contentDetails",
      id: newestVideoIds.join(","),
    });
    const latestPayload = await this.request<YouTubeVideoResponse>("videos", latestParams);
    const availableById = new Map(
      (latestPayload.items ?? []).flatMap((raw) => {
        const item = mapVideoItems([raw])[0];
        const durationSec = parseDurationSeconds(raw.contentDetails?.duration);
        return item && isRecommendationDuration(durationSec)
          ? [[item.videoId, item] as const]
          : [];
      }),
    );
    return newestVideoIds.flatMap((id) => {
      const item = availableById.get(id);
      return item ? [item] : [];
    }).slice(0, 16);
  }

  private async loadCommunityCandidates(
    tracks: SimilarTrack[],
    excluded: Set<string>,
  ): Promise<YouTubeSearchResult[]> {
    const query = tracks
      .slice(0, 8)
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

  private cacheSimilar(cacheKey: string, items: YouTubeSearchResult[], ttlMs = SIMILAR_CACHE_TTL_MS) {
    trimCache(this.similarCache);
    this.similarCache.set(cacheKey, {
      expiresAt: Date.now() + (items.length ? ttlMs : 60_000),
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
      if (!isRecommendationDuration(durationSec)) return [];

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
          + artistCoverage * 0.21
          + track.match * 0.12
          + popularity * 0.06
          + presentationQualityScore(item) * 0.07
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

export function diversifyRecommendations(
  items: YouTubeSearchResult[],
  excludedVideoId: string,
  limit = 8,
  sourceArtist = "",
) {
  const canonical = deduplicateTrackVersions(items);
  const seen = new Set([excludedVideoId]);
  const artistBuckets = new Map<string, YouTubeSearchResult[]>();

  for (const item of canonical) {
    if (seen.has(item.videoId)) continue;
    seen.add(item.videoId);
    const artist = recommendationArtistKey(item);
    const bucket = artistBuckets.get(artist) ?? [];
    bucket.push(item);
    artistBuckets.set(artist, bucket);
  }

  const sourceArtistKey = normalizeText(cleanChannelTitle(sourceArtist));
  const artistOrder = [...artistBuckets.keys()].sort((left, right) => {
    if (left === sourceArtistKey && right !== sourceArtistKey) return 1;
    if (right === sourceArtistKey && left !== sourceArtistKey) return -1;
    return 0;
  });
  const selected: YouTubeSearchResult[] = [];
  for (let round = 0; round < 3 && selected.length < limit; round += 1) {
    for (const artist of artistOrder) {
      const bucket = artistBuckets.get(artist);
      if (!bucket) continue;
      const item = bucket.shift();
      if (item) selected.push(item);
      if (selected.length === limit) break;
    }
  }

  if (selected.length < limit) {
    const selectedIds = new Set(selected.map((item) => item.videoId));
    for (const item of canonical) {
      if (item.videoId === excludedVideoId || selectedIds.has(item.videoId)) continue;
      selected.push(item);
      selectedIds.add(item.videoId);
      if (selected.length === limit) break;
    }
  }
  return selected;
}

function recommendationArtistKey(item: YouTubeSearchResult) {
  const artist = extractTrackIdentity(item.title, item.channelTitle).artist;
  return normalizeText(cleanChannelTitle(artist)) || item.videoId;
}

function deduplicateTrackVersions(items: YouTubeSearchResult[]) {
  const bestByTrack = new Map<
    string,
    { item: YouTubeSearchResult; firstIndex: number; quality: number }
  >();
  items.forEach((item, index) => {
    const key = canonicalTrackKey(item);
    const quality = presentationQualityScore(item);
    const existing = bestByTrack.get(key);
    if (!existing) {
      bestByTrack.set(key, { item, firstIndex: index, quality });
    } else if (quality > existing.quality) {
      bestByTrack.set(key, { item, firstIndex: existing.firstIndex, quality });
    }
  });
  return [...bestByTrack.values()]
    .sort((left, right) => left.firstIndex - right.firstIndex)
    .map(({ item }) => item);
}

function canonicalTrackKey(item: YouTubeSearchResult) {
  const identity = extractTrackIdentity(item.title, item.channelTitle);
  const artist = normalizeText(identity.artist);
  const title = normalizeText(identity.title)
    .replace(/\b(?:remaster(?:ed)?|version|edit|extended)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return artist && title ? `${artist}\u0000${title}` : item.videoId;
}

function presentationQualityScore(item: YouTubeSearchResult) {
  const title = normalizeText(item.title);
  const channel = item.channelTitle;
  let score = 0;
  if (/\bofficial\b/i.test(item.title)) score += 0.45;
  if (/VEVO$/i.test(channel) || /\s+-\s+Topic$/i.test(channel)) score += 0.45;
  if (/\b(?:lyrics?|live|cover|karaoke|reaction|nightcore|sped up|slowed)\b/i.test(title)) {
    score -= 0.55;
  }
  return Math.max(-1, Math.min(1, score));
}

const MUSIC_NOISE = new Set([
  "official", "video", "audio", "lyrics", "lyric", "mv", "m", "v", "hd", "4k",
  "vietsub", "visualizer", "music", "records", "recordings",
]);

function cleanMusicText(value: string) {
  return value
    .replace(/[\[(][^\])]*(?:official|music video|audio|lyrics?|mv|hd|4k|visualizer|live|cover|karaoke|remaster)[^\])]*[\])]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanChannelTitle(value: string) {
  return value
    .replace(/\s+-\s+Topic$/i, "")
    .replace(/VEVO$/i, "")
    .replace(/\b(?:official|music|records|recordings|channel)\b/gi, " ")
    .replace(/\s+/g, " ")
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
  const strongVariants = ["karaoke", "reaction", "cover"];
  if (strongVariants.some((variant) => candidateText.includes(variant) && !targetText.includes(variant))) {
    return 0.34;
  }
  const softVariants = ["live", "lyrics", "lyric", "nightcore", "sped up", "slowed"];
  return softVariants.some((variant) => candidateText.includes(variant) && !targetText.includes(variant))
    ? 0.24
    : 0;
}

function isRecommendationDuration(durationSec: number | null) {
  return durationSec === null
    || (durationSec >= MIN_RECOMMENDATION_DURATION_SEC
      && durationSec <= MAX_RECOMMENDATION_DURATION_SEC);
}

function validUniqueVideoIds(values: string[], initial = new Set<string>()) {
  const seen = new Set(initial);
  return values.flatMap((value) => {
    const videoId = value.trim();
    if (!VIDEO_ID_PATTERN.test(videoId) || seen.has(videoId)) return [];
    seen.add(videoId);
    return [videoId];
  });
}

function selectRecommendations(
  items: YouTubeSearchResult[],
  excluded: Set<string>,
  seen: Set<string>,
) {
  const available = items.filter((item) => !excluded.has(item.videoId));
  const fresh = available.filter((item) => !seen.has(item.videoId));
  return (fresh.length > 0 ? fresh : available).slice(0, 8);
}

function blendSimilarTrackGroups(groups: SimilarTrack[][]) {
  const merged = new Map<string, SimilarTrack>();
  groups.forEach((tracks, groupIndex) => {
    const weight = [1, 0.76, 0.6, 0.48, 0.4][groupIndex] ?? 0.35;
    const take = groupIndex === 0 ? 4 : 2;
    for (const track of tracks.slice(0, take)) {
      const key = `${normalizeText(track.artist)}\u0000${normalizeText(track.title)}`;
      const weighted = { ...track, match: track.match * weight };
      const existing = merged.get(key);
      if (!existing || weighted.match > existing.match) merged.set(key, weighted);
    }
  });
  return [...merged.values()].sort((left, right) => right.match - left.match).slice(0, 10);
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
