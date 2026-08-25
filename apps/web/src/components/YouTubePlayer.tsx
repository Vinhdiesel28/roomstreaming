import { CircleAlert, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { expectedPosition, loadYouTubeApi } from "../lib/youtube";
import type { Playback, PlaybackCommand } from "../types";

interface Props {
  playback: Playback | null;
  isHost: boolean;
  onCommand: (action: PlaybackCommand, positionSec?: number) => Promise<unknown>;
  onEnded?: () => Promise<unknown> | unknown;
}

export function YouTubePlayer({ playback, isHost, onCommand, onEnded }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const playerReadyRef = useRef(false);
  const playbackRef = useRef(playback);
  const isHostRef = useRef(isHost);
  const onEndedRef = useRef(onEnded);
  const applyingRef = useRef(false);
  const applyingTimerRef = useRef<number | null>(null);
  const lastVersionRef = useRef(-1);
  const lastVideoIdRef = useRef<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  playbackRef.current = playback;
  isHostRef.current = isHost;
  onEndedRef.current = onEnded;

  const markApplying = useCallback(() => {
    applyingRef.current = true;
    if (applyingTimerRef.current !== null) window.clearTimeout(applyingTimerRef.current);
    applyingTimerRef.current = window.setTimeout(() => {
      applyingRef.current = false;
      applyingTimerRef.current = null;
    }, 750);
  }, []);

  const applyPlayback = useCallback((next: Playback, forceLoad = false, forceSeek = false) => {
    const player = playerRef.current;
    if (!player || !playerReadyRef.current) return;
    const position = expectedPosition(next);
    const changedVideo = forceLoad || lastVideoIdRef.current !== next.videoId;
    const playerState = player.getPlayerState();
    let shouldMarkApplying = changedVideo;
    setError(null);
    setBlocked(false);
    if (changedVideo) {
      markApplying();
      if (next.state === "playing") player.loadVideoById(next.videoId, position);
      else player.cueVideoById(next.videoId, position);
    } else {
      const drift = Math.abs(player.getCurrentTime() - position);
      const isBuffering = playerState === YT.PlayerState.BUFFERING;
      if (forceSeek || (!isBuffering && drift > 4)) {
        shouldMarkApplying = true;
        player.seekTo(position, true);
      }
      if (
        next.state === "playing"
        && playerState !== YT.PlayerState.PLAYING
        && playerState !== YT.PlayerState.BUFFERING
      ) {
        shouldMarkApplying = true;
        player.playVideo();
      }
      if (
        next.state === "paused"
        && (playerState === YT.PlayerState.PLAYING || playerState === YT.PlayerState.BUFFERING)
      ) {
        shouldMarkApplying = true;
        player.pauseVideo();
      }
      if (shouldMarkApplying) markApplying();
    }
    lastVideoIdRef.current = next.videoId;
    lastVersionRef.current = next.version;
  }, [markApplying]);

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
            const current = playbackRef.current;
            const drift = current ? Math.abs(expectedPosition(current) - position) : Number.POSITIVE_INFINITY;
            if (event.data === YT.PlayerState.PLAYING && (current?.state !== "playing" || drift > 2)) {
              void onCommand("PLAY", position);
            }
            if (event.data === YT.PlayerState.PAUSED && (current?.state !== "paused" || drift > 2)) {
              void onCommand("PAUSE", position);
            }
            if (event.data === YT.PlayerState.ENDED) {
              if (onEndedRef.current) void onEndedRef.current();
              else void onCommand("NEXT", 0);
            }
          },
          onError: () => setError("Video này không thể phát nhúng. Hãy thử video khác."),
          onAutoplayBlocked: () => setBlocked(true),
        },
      });
    });
    return () => {
      disposed = true;
      if (applyingTimerRef.current !== null) window.clearTimeout(applyingTimerRef.current);
      playerReadyRef.current = false;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [applyPlayback, onCommand]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !playerReadyRef.current) return;
    if (!playback) {
      markApplying();
      player.stopVideo();
      lastVideoIdRef.current = null;
      lastVersionRef.current = -1;
      return;
    }
    const changedVideo = lastVideoIdRef.current !== playback.videoId;
    const changedVersion = playback.version !== lastVersionRef.current;
    applyPlayback(
      playback,
      changedVideo,
      changedVideo || (!isHostRef.current && changedVersion),
    );
  }, [applyPlayback, markApplying, playback]);

  useEffect(() => {
    if (!playback || isHost) return;
    const timer = window.setInterval(
      () => applyPlayback(playbackRef.current ?? playback, false, false),
      10_000,
    );
    return () => {
      window.clearInterval(timer);
    };
  }, [applyPlayback, isHost, playback]);

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
