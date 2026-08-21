import type { YouTubeSearchResult } from "../types";

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
const TOKEN_KEY = "watchroom.session.token";

export function apiUrl() {
  return API_URL;
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
