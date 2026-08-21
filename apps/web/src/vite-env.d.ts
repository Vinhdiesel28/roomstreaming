/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_TURN_URL?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  YT?: typeof YT;
  onYouTubeIframeAPIReady?: () => void;
}

declare namespace YT {
  const PlayerState: {
    UNSTARTED: -1;
    ENDED: 0;
    PLAYING: 1;
    PAUSED: 2;
    BUFFERING: 3;
    CUED: 5;
  };

  class Player {
    constructor(element: HTMLElement, options: PlayerOptions);
    destroy(): void;
    cueVideoById(videoId: string, startSeconds?: number): void;
    loadVideoById(videoId: string, startSeconds?: number): void;
    playVideo(): void;
    pauseVideo(): void;
    stopVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    getCurrentTime(): number;
    getPlayerState(): number;
  }

  interface PlayerEvent {
    target: Player;
  }

  interface OnStateChangeEvent extends PlayerEvent {
    data: number;
  }

  interface PlayerOptions {
    width?: string | number;
    height?: string | number;
    videoId?: string;
    playerVars?: Record<string, string | number>;
    events?: {
      onReady?: (event: PlayerEvent) => void;
      onStateChange?: (event: OnStateChangeEvent) => void;
      onError?: (event: { data: number; target: Player }) => void;
      onAutoplayBlocked?: (event: PlayerEvent) => void;
    };
  }
}
