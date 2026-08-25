import type { YouTubeSearchResult } from "../types";

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
const TOKEN_KEY = "watchroom.session.token";
const MAX_RECOMMENDATION_EXCLUSIONS = 100;
const MAX_SEEN_RECOMMENDATIONS = 60;

export interface ServerHealth {
  ok: boolean;
  features?: {
    profiles?: boolean;
    roomRecovery?: boolean;
    youtubeSimilar?: boolean;
    musicRecommendations?: boolean;
  };
  revision?: string;
}

export function apiUrl() {
  return API_URL;
}

export async function getServerHealth(): Promise<ServerHealth> {
  const response = await fetch(`${API_URL}/health`);
  if (!response.ok) throw new Error("Máy chủ chưa sẵn sàng.");
  return response.json() as Promise<ServerHealth>;
}

export async function getSessionToken() {
  const existing = localStorage.getItem(TOKEN_KEY);
  if (existing) return existing;
  const response = await fetch(`${API_URL}/api/session`, { method: "POST" });
  if (!response.ok) throw new Error("Không thể tạo phiên kết nối.");
  const payload = (await response.json()) as { token: string };
  localStorage.setItem(TOKEN_KEY, payload.token);
  return payload.token;
}

export function resetSessionToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function searchYouTube(query: string): Promise<YouTubeSearchResult[]> {
  const response = await fetch(`${API_URL}/api/youtube/search?q=${encodeURIComponent(query)}`);
  const payload = (await response.json().catch(() => ({}))) as {
    items?: YouTubeSearchResult[];
    message?: string;
  };
  if (!response.ok) {
    throw new Error(payload.message ?? "Không tìm được video YouTube.");
  }
  return payload.items ?? [];
}

export async function getSimilarYouTubeVideos(
  videoId: string,
  contextVideoIds: string[] = [],
  excludedVideoIds: string[] = [],
  seenVideoIds: string[] = [],
): Promise<YouTubeSearchResult[]> {
  const params = new URLSearchParams({ videoId });
  if (contextVideoIds.length > 0) params.set("context", contextVideoIds.slice(0, 4).join(","));
  if (excludedVideoIds.length > 0) {
    params.set("exclude", excludedVideoIds.slice(0, MAX_RECOMMENDATION_EXCLUSIONS).join(","));
  }
  if (seenVideoIds.length > 0) {
    params.set("seen", seenVideoIds.slice(-MAX_SEEN_RECOMMENDATIONS).join(","));
  }
  const response = await fetch(`${API_URL}/api/youtube/similar?${params}`);
  const payload = (await response.json().catch(() => ({}))) as {
    items?: YouTubeSearchResult[];
    message?: string;
  };
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        "Backend trên Render đang dùng phiên bản cũ. Hãy deploy lại dịch vụ roomstreaming-api.",
      );
    }
    throw new Error(payload.message ?? "Không lấy được gợi ý video.");
  }
  return payload.items ?? [];
}
