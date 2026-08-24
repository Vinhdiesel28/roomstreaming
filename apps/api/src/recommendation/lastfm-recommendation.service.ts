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

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

@Injectable()
export class LastFmRecommendationService {
  private readonly cache = new Map<string, { expiresAt: number; tracks: SimilarTrack[] }>();
  private readonly pending = new Map<string, Promise<SimilarTrack[]>>();

  configured() {
    return Boolean(process.env.LASTFM_API_KEY?.trim());
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
      .catch(() => [])
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
    if (!response.ok) return [];
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
}

function trimCache(cache: Map<string, unknown>) {
  if (cache.size < MAX_CACHE_ENTRIES) return;
  const oldestKey = cache.keys().next().value as string | undefined;
  if (oldestKey) cache.delete(oldestKey);
}
