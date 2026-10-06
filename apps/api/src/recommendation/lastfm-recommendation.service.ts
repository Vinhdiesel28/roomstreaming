import { Injectable } from "@nestjs/common";

export interface SimilarTrack {
  artist: string;
  title: string;
  match: number;
}

interface LastFmSimilarResponse {
  similartracks?: {
    track?: Array<{
      name?: string;
      match?: string;
      artist?: { name?: string };
    }>;
  };
}

interface LastFmSimilarArtistsResponse {
  similarartists?: {
    artist?: Array<{ name?: string; match?: string }>;
  };
}

interface LastFmTopTracksResponse {
  toptracks?: {
    track?: Array<{ name?: string }>;
  };
}

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

@Injectable()
export class LastFmRecommendationService {
  private readonly cache = new Map<string, { expiresAt: number; tracks: SimilarTrack[] }>();
  private readonly pending = new Map<string, Promise<SimilarTrack[]>>();
  private readonly artistDiscoveryCache = new Map<
    string,
    { expiresAt: number; tracks: SimilarTrack[] }
  >();
  private readonly artistDiscoveryPending = new Map<string, Promise<SimilarTrack[]>>();
  private lastSuccessAt: number | null = null;
  private lastFailureAt: number | null = null;
  private lastError: string | null = null;

  configured() {
    return Boolean(process.env.LASTFM_API_KEY?.trim());
  }

  health() {
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

  async similarTracks(artistInput: string, titleInput: string, limit = 10) {
    const apiKey = process.env.LASTFM_API_KEY?.trim();
    const artist = artistInput.trim();
    const title = titleInput.trim();
    if (!apiKey || !artist || !title) return [];

    const key = `${artist}\u0000${title}`.toLocaleLowerCase("vi-VN");
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.tracks.slice(0, limit);
    const existing = this.pending.get(key);
    if (existing) return (await existing).slice(0, limit);

    const request = this.load(apiKey, artist, title)
      .then((tracks) => {
        this.lastSuccessAt = Date.now();
        this.lastError = null;
        return tracks;
      })
      .catch((error: unknown) => {
        this.lastFailureAt = Date.now();
        this.lastError = error instanceof Error ? error.message.slice(0, 80) : "LASTFM_UNAVAILABLE";
        return [];
      })
      .then((tracks) => {
        trimCache(this.cache);
        this.cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, tracks });
        return tracks;
      })
      .finally(() => {
        if (this.pending.get(key) === request) this.pending.delete(key);
      });
    this.pending.set(key, request);
    return (await request).slice(0, limit);
  }

  async artistDiscoveryTracks(artistInput: string, limit = 10) {
    const apiKey = process.env.LASTFM_API_KEY?.trim();
    const artist = artistInput.trim();
    if (!apiKey || !artist) return [];

    const key = artist.toLocaleLowerCase("vi-VN");
    const cached = this.artistDiscoveryCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.tracks.slice(0, limit);
    const existing = this.artistDiscoveryPending.get(key);
    if (existing) return (await existing).slice(0, limit);

    const request = this.loadArtistDiscovery(apiKey, artist)
      .then((tracks) => {
        this.lastSuccessAt = Date.now();
        this.lastError = null;
        trimCache(this.artistDiscoveryCache);
        this.artistDiscoveryCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, tracks });
        return tracks;
      })
      .catch((error: unknown) => {
        this.lastFailureAt = Date.now();
        this.lastError = error instanceof Error ? error.message.slice(0, 80) : "LASTFM_UNAVAILABLE";
        return [];
      })
      .finally(() => {
        if (this.artistDiscoveryPending.get(key) === request) {
          this.artistDiscoveryPending.delete(key);
        }
      });
    this.artistDiscoveryPending.set(key, request);
    return (await request).slice(0, limit);
  }

  private async load(apiKey: string, artist: string, title: string): Promise<SimilarTrack[]> {
    const params = new URLSearchParams({
      method: "track.getsimilar",
      artist,
      track: title,
      api_key: apiKey,
      autocorrect: "1",
      limit: "20",
      format: "json",
    });
    const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`LASTFM_HTTP_${response.status}`);
    const payload = (await response.json().catch(() => ({}))) as LastFmSimilarResponse;
    const seen = new Set<string>();
    return (payload.similartracks?.track ?? []).flatMap<SimilarTrack>((item) => {
      const candidateArtist = item.artist?.name?.trim() ?? "";
      const candidateTitle = item.name?.trim() ?? "";
      const match = Number.parseFloat(item.match ?? "0");
      const candidateKey = `${candidateArtist}\u0000${candidateTitle}`.toLocaleLowerCase("vi-VN");
      if (!candidateArtist || !candidateTitle || seen.has(candidateKey)) return [];
      seen.add(candidateKey);
      return [{
        artist: candidateArtist,
        title: candidateTitle,
        match: Number.isFinite(match) ? Math.min(1, Math.max(0, match)) : 0,
      }];
    });
  }

  private async loadArtistDiscovery(apiKey: string, artist: string): Promise<SimilarTrack[]> {
    const similarParams = new URLSearchParams({
      method: "artist.getsimilar",
      artist,
      api_key: apiKey,
      autocorrect: "1",
      limit: "8",
      format: "json",
    });
    const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${similarParams}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`LASTFM_HTTP_${response.status}`);
    const payload = (await response.json().catch(() => ({}))) as LastFmSimilarArtistsResponse;
    const artists = (payload.similarartists?.artist ?? []).flatMap((item) => {
      const name = item.name?.trim() ?? "";
      const match = Number.parseFloat(item.match ?? "0");
      return name ? [{
        name,
        match: Number.isFinite(match) ? Math.min(1, Math.max(0, match)) : 0,
      }] : [];
    }).slice(0, 6);

    const topTracks = await Promise.all(artists.map(async (candidate) => {
      const params = new URLSearchParams({
        method: "artist.gettoptracks",
        artist: candidate.name,
        api_key: apiKey,
        autocorrect: "1",
        limit: "3",
        format: "json",
      });
      try {
        const trackResponse = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`, {
          signal: AbortSignal.timeout(8_000),
        });
        if (!trackResponse.ok) return [];
        const trackPayload = (await trackResponse.json().catch(() => ({}))) as LastFmTopTracksResponse;
        return (trackPayload.toptracks?.track ?? []).slice(0, 2).flatMap<SimilarTrack>((track, index) => {
          const title = track.name?.trim() ?? "";
          return title ? [{
            artist: candidate.name,
            title,
            match: candidate.match * (index === 0 ? 0.9 : 0.72),
          }] : [];
        });
      } catch {
        return [];
      }
    }));

    const seen = new Set<string>();
    return topTracks.flat().filter((track) => {
      const trackKey = `${track.artist}\u0000${track.title}`.toLocaleLowerCase("vi-VN");
      if (seen.has(trackKey)) return false;
      seen.add(trackKey);
      return true;
    });
  }
}

function trimCache(cache: Map<string, unknown>) {
  if (cache.size < MAX_CACHE_ENTRIES) return;
  const oldestKey = cache.keys().next().value as string | undefined;
  if (oldestKey) cache.delete(oldestKey);
}
