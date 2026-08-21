import { CircleAlert, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { expectedPosition, loadYouTubeApi } from "../lib/youtube";
import type { Playback, PlaybackCommand } from "../types";

interface Props {
  playback: Playback | null;
  isHost: boolean;
  onCommand: (action: PlaybackCommand, positionSec?: number) => Promise<unknown>;
}

export function YouTubePlayer({ playback, isHost, onCommand }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const playerReadyRef = useRef(false);
  const playbackRef = useRef(playback);
  const isHostRef = useRef(isHost);
  const applyingRef = useRef(false);
  const lastVersionRef = useRef(-1);
  const lastVideoIdRef = useRef<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  playbackRef.current = playback;
  isHostRef.current = isHost;

  const applyPlayback = useCallback((next: Playback, forceLoad = false, forceSeek = false) => {
    const player = playerRef.current;
    if (!player || !playerReadyRef.current) return;
    applyingRef.current = true;
    const position = expectedPosition(next);
    const changedVideo = forceLoad || lastVideoIdRef.current !== next.videoId;
    setError(null);
    setBlocked(false);
    if (changedVideo) {
      if (next.state === "playing") player.loadVideoById(next.videoId, position);
      else player.cueVideoById(next.videoId, position);
    } else {
      const drift = Math.abs(player.getCurrentTime() - position);
      if (forceSeek || drift > 1.5) player.seekTo(position, true);
      if (next.state === "playing") player.playVideo();
      else player.pauseVideo();
    }
    lastVideoIdRef.current = next.videoId;
    lastVersionRef.current = next.version;
    window.setTimeout(() => {
      applyingRef.current = false;
    }, 450);
  }, []);

  useEffect(() => {
    if (!mountRef.current) return;
    let disposed = false;
    void loadYouTubeApi().then(() => {
      if (disposed || !mountRef.current || playerRef.current) return;
      playerRef.current = new YT.Player(mountRef.current, {
        width: "100%",
        height: "100%",
        playerVars: {
          controls: 1,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            playerReadyRef.current = true;
            const current = playbackRef.current;
            if (current) applyPlayback(current, true, true);
          },
          onStateChange: (event) => {
            if (!isHostRef.current || applyingRef.current) return;
            const position = event.target.getCurrentTime();
            if (event.data === YT.PlayerState.PLAYING) void onCommand("PLAY", position);
            if (event.data === YT.PlayerState.PAUSED) void onCommand("PAUSE", position);
            if (event.data === YT.PlayerState.ENDED) void onCommand("NEXT", 0);
          },
          onError: () => setError("Video này không thể phát nhúng. Hãy thử video khác."),
          onAutoplayBlocked: () => setBlocked(true),
        },
      });
    });
    return () => {
      disposed = true;
      playerReadyRef.current = false;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [applyPlayback, onCommand]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !playerReadyRef.current) return;
    if (!playback) {
      applyingRef.current = true;
      player.stopVideo();
      lastVideoIdRef.current = null;
      lastVersionRef.current = -1;
      window.setTimeout(() => {
        applyingRef.current = false;
      }, 450);
      return;
    }
    const changedVideo = lastVideoIdRef.current !== playback.videoId;
    applyPlayback(
      playback,
      changedVideo,
      changedVideo || playback.version !== lastVersionRef.current,
    );
  }, [applyPlayback, playback]);

  useEffect(() => {
    if (!playback) return;
    const timer = window.setInterval(
      () => applyPlayback(playbackRef.current ?? playback, false, false),
      5_000,
    );
    return () => {
      window.clearInterval(timer);
    };
  }, [applyPlayback, playback]);

  return (
    <div className={`player-wrap ${playback ? "" : "is-empty"}`}>
      <div className="youtube-mount" ref={mountRef} />
      {!playback && (
        <div className="player-empty">
          <div className="player-empty__mark" aria-hidden="true"><Play size={26} /></div>
          <h2>Chưa có video</h2>
          <p>Dán link hoặc tìm video YouTube để bắt đầu.</p>
        </div>
      )}
      {playback && (blocked || error) && (
        <div className="player-notice" role="status">
          {error ? <CircleAlert size={18} /> : <Play size={18} />}
          <span>{error ?? "Trình duyệt đã chặn tự phát. Nhấn phát trong player để bắt nhịp."}</span>
          {blocked && !error && (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setBlocked(false);
                applyPlayback(playback, false, true);
              }}
            >
              Bắt nhịp
            </button>
          )}
        </div>
      )}
    </div>
  );
}
