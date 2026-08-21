const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeVideoId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (VIDEO_ID_PATTERN.test(value)) return value;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
  let videoId: string | null = null;
  if (hostname === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (
    hostname === "youtube.com" ||
    hostname === "m.youtube.com" ||
    hostname === "music.youtube.com"
  ) {
    if (url.pathname === "/watch") videoId = url.searchParams.get("v");
    else {
      const parts = url.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live"].includes(parts[0] ?? "")) {
        videoId = parts[1] ?? null;
      }
    }
  }

  return videoId && VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
}
