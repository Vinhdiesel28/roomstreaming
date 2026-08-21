let loader: Promise<typeof YT> | null = null;

export function loadYouTubeApi(): Promise<typeof YT> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    const existingCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      existingCallback?.();
      if (window.YT) resolve(window.YT);
      else reject(new Error("YouTube API không sẵn sàng."));
    };

    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => reject(new Error("Không tải được YouTube Player API."));
      document.head.append(script);
    }
  });
  return loader;
}

export function expectedPosition(playback: {
  state: "playing" | "paused";
  positionSec: number;
  changedAt: number;
}) {
  if (playback.state === "paused") return playback.positionSec;
  return playback.positionSec + Math.max(0, Date.now() - playback.changedAt) / 1000;
}
