const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeVideoId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (VIDEO_ID_PATTERN.test(value)) return value;

  let url: URL;
  try {
    const withProtocol = value.startsWith("//")
      ? `https:${value}`
      : /^[a-z][a-z\d+.-]*:\/\//i.test(value)
        ? value
        : `https://${value}`;
    url = new URL(withProtocol);
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
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    if (pathname === "/watch") videoId = url.searchParams.get("v");
    else if (pathname === "/attribution_link") {
      const nestedPath = url.searchParams.get("u");
      if (nestedPath) return parseYouTubeVideoId(new URL(nestedPath, "https://youtube.com").toString());
    }
    else {
      const parts = pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live", "v", "e"].includes(parts[0] ?? "")) {
        videoId = parts[1] ?? null;
      }
    }
  } else if (hostname === "youtube-nocookie.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "embed") videoId = parts[1] ?? null;
  }

  return videoId && VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
}
