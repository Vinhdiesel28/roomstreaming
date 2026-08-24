import type { YouTubeSearchResult } from "../types";

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
const TOKEN_KEY = "watchroom.session.token";

export interface ServerHealth {
  ok: boolean;
  features?: {
    profiles?: boolean;
    roomRecovery?: boolean;
    youtubeSimilar?: boolean;
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

export async function getSimilarYouTubeVideos(videoId: string): Promise<YouTubeSearchResult[]> {
  const response = await fetch(
    `${API_URL}/api/youtube/similar?videoId=${encodeURIComponent(videoId)}`,
  );
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
