// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Playback } from "../types";
import { YouTubePlayer } from "./YouTubePlayer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const playerSpies = {
  cueVideoById: vi.fn(),
  loadVideoById: vi.fn(),
  destroy: vi.fn(),
  playVideo: vi.fn(),
  pauseVideo: vi.fn(),
  stopVideo: vi.fn(),
  seekTo: vi.fn(),
};

class FakePlayer {
  constructor(_element: HTMLElement, options: YT.PlayerOptions) {
    queueMicrotask(() => options.events?.onReady?.({ target: this as unknown as YT.Player }));
  }

  cueVideoById = playerSpies.cueVideoById;
  loadVideoById = playerSpies.loadVideoById;
  destroy = playerSpies.destroy;
  playVideo = playerSpies.playVideo;
  pauseVideo = playerSpies.pauseVideo;
  stopVideo = playerSpies.stopVideo;
  seekTo = playerSpies.seekTo;
  getCurrentTime = () => 0;
  getPlayerState = () => YT.PlayerState.CUED;
}

vi.mock("../lib/youtube", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/youtube")>();
  return {
    ...actual,
    loadYouTubeApi: vi.fn(async () => window.YT as typeof YT),
  };
});

describe("YouTubePlayer", () => {
  beforeEach(() => {
    Object.values(playerSpies).forEach((spy) => spy.mockClear());
    window.YT = {
      Player: FakePlayer as unknown as typeof YT.Player,
      PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
    } as typeof YT;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("loads the first video added after an initially empty room", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onCommand = vi.fn(async () => undefined);

    await act(async () => {
      root.render(<YouTubePlayer playback={null} isHost onCommand={onCommand} />);
    });

    const playback: Playback = {
      videoId: "dQw4w9WgXcQ",
      state: "paused",
      positionSec: 0,
      changedAt: Date.now(),
      version: 1,
    };
    await act(async () => {
      root.render(<YouTubePlayer playback={playback} isHost onCommand={onCommand} />);
    });

    expect(playerSpies.cueVideoById).toHaveBeenCalledWith("dQw4w9WgXcQ", 0);
    await act(async () => root.unmount());
  });
});
