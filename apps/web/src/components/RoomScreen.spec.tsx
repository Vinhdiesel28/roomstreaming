// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RoomSnapshot } from "../types";
import { RoomScreen } from "./RoomScreen";

const snapshot: RoomSnapshot = {
  roomCode: "ABCD2345",
  hostSessionId: "session-1",
  isHost: true,
  currentVideo: null,
  queue: [],
  queueVersion: 0,
  members: [
    {
      sessionId: "session-1",
      name: "Vinh",
      joinedAt: 1,
      online: true,
      isHost: true,
    },
  ],
  serverTime: 1,
};

describe("RoomScreen layout", () => {
  it("orders the picker before video, chat, compact voice and secondary panels", () => {
    const html = renderToStaticMarkup(
      <RoomScreen
        snapshot={snapshot}
        sessionId="session-1"
        messages={[]}
        connected
        socket={null}
        onLeave={vi.fn(async () => undefined)}
        onAddVideo={vi.fn(async () => undefined)}
        onRemoveVideo={vi.fn(async () => undefined)}
        onCommand={vi.fn(async () => undefined)}
        onSendChat={vi.fn(async () => undefined)}
      />,
    );

    const picker = html.indexOf('class="video-picker"');
    const video = html.indexOf('class="video-stage"');
    const meta = html.indexOf('class="video-meta"');
    const chat = html.indexOf('class="chat-panel"');
    const voice = html.indexOf('class="voice-card"');
    const queue = html.indexOf('class="queue-panel"');
    const members = html.indexOf('class="members-panel"');

    expect(picker).toBeGreaterThan(-1);
    expect(picker).toBeLessThan(video);
    expect(video).toBeLessThan(meta);
    expect(meta).toBeLessThan(chat);
    expect(chat).toBeLessThan(voice);
    expect(voice).toBeLessThan(queue);
    expect(queue).toBeLessThan(members);
    expect(html).toContain('id="youtube-search"');
  });

  it("offers similar videos manually when a video is playing", () => {
    const html = renderToStaticMarkup(
      <RoomScreen
        snapshot={{
          ...snapshot,
          currentVideo: {
            videoId: "dQw4w9WgXcQ",
            state: "paused",
            positionSec: 0,
            changedAt: 1,
            version: 1,
          },
        }}
        sessionId="session-1"
        messages={[]}
        connected
        socket={null}
        onLeave={vi.fn(async () => undefined)}
        onAddVideo={vi.fn(async () => undefined)}
        onRemoveVideo={vi.fn(async () => undefined)}
        onCommand={vi.fn(async () => undefined)}
        onSendChat={vi.fn(async () => undefined)}
      />,
    );

    expect(html).toContain("Video tương tự");
    expect(html).not.toContain('id="similar-title"');
  });
});
