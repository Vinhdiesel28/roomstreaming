// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RoomSnapshot } from "../types";
import { RoomScreen, VideoResultRow } from "./RoomScreen";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

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
      avatarUrl: null,
      joinedAt: 1,
      online: true,
      isHost: true,
    },
  ],
  serverTime: 1,
};

describe("RoomScreen layout", () => {
  it("plays from the result body and reserves plus for adding to the queue", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onAdd = vi.fn();
    const onPlay = vi.fn();

    act(() => {
      root.render(
        <VideoResultRow
          result={{
            videoId: "dQw4w9WgXcQ",
            title: "Video thử nghiệm",
            channelTitle: "Kênh thử nghiệm",
            thumbnailUrl: "https://i.ytimg.com/test.jpg",
          }}
          state="idle"
          interactionDisabled={false}
          canPlayNow
          playing={false}
          onPlay={onPlay}
          onAdd={onAdd}
        />,
      );
    });

    const playButton = container.querySelector<HTMLButtonElement>(".search-result__main");
    const addButton = container.querySelector<HTMLButtonElement>(".search-result__add");
    act(() => playButton?.click());
    act(() => addButton?.click());

    expect(playButton?.querySelector("img")).not.toBeNull();
    expect(playButton?.textContent).toContain("Video thử nghiệm");
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

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
        onPlayVideoDirectly={vi.fn(async () => undefined)}
        onRemoveVideo={vi.fn(async () => undefined)}
        onPlayVideo={vi.fn(async () => undefined)}
        onCommand={vi.fn(async () => undefined)}
        onSendChat={vi.fn(async () => undefined)}
        onUpdateProfile={vi.fn(async () => undefined)}
      />,
    );

    const picker = html.indexOf('class="video-picker"');
    const video = html.indexOf('class="video-stage"');
    const meta = html.indexOf('class="video-meta"');
    const chat = html.indexOf('class="chat-panel chat-theme-paper"');
    const voice = html.indexOf('class="voice-card"');
    const chatLog = html.indexOf('class="chat-log"');
    const queue = html.indexOf('class="queue-panel"');
    const members = html.indexOf('class="members-panel"');

    expect(picker).toBeGreaterThan(-1);
    expect(picker).toBeLessThan(video);
    expect(video).toBeLessThan(meta);
    expect(meta).toBeLessThan(chat);
    expect(chat).toBeLessThan(voice);
    expect(voice).toBeLessThan(chatLog);
    expect(chatLog).toBeLessThan(queue);
    expect(queue).toBeLessThan(members);
    expect(html).toContain('id="youtube-search"');
    expect(html).toContain('class="mobile-chat-toggle"');
    expect(html).toContain('aria-controls="room-chat"');
    expect(html).toContain('class="chat-panel chat-theme-paper"');
    expect(html).not.toContain("is-mobile-closed");
    expect(html).toContain('class="profile-avatar-button"');
    expect(html).toContain("Vào voice");
    expect(html).not.toContain("Không ghi âm");
    expect(html).not.toContain("Bạn đang ở đây một mình");
  });

  it("keeps the same-channel panel visible while suggestions load", () => {
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
        onPlayVideoDirectly={vi.fn(async () => undefined)}
        onRemoveVideo={vi.fn(async () => undefined)}
        onPlayVideo={vi.fn(async () => undefined)}
        onCommand={vi.fn(async () => undefined)}
        onSendChat={vi.fn(async () => undefined)}
        onUpdateProfile={vi.fn(async () => undefined)}
      />,
    );

    expect(html).toContain("Hợp gu phòng");
    expect(html).toContain('id="similar-title"');
  });

  it("renders messages as reply targets and shows quoted messages", () => {
    const html = renderToStaticMarkup(
      <RoomScreen
        snapshot={snapshot}
        sessionId="session-1"
        messages={[{
          id: "message-2",
          senderSessionId: "session-1",
          senderName: "Vinh",
          text: "Mình đồng ý",
          sentAt: 2,
          replyTo: {
            messageId: "message-1",
            senderName: "Bạn",
            text: "Xem video này nhé",
          },
        }]}
        connected
        socket={null}
        onLeave={vi.fn(async () => undefined)}
        onAddVideo={vi.fn(async () => undefined)}
        onPlayVideoDirectly={vi.fn(async () => undefined)}
        onRemoveVideo={vi.fn(async () => undefined)}
        onPlayVideo={vi.fn(async () => undefined)}
        onCommand={vi.fn(async () => undefined)}
        onSendChat={vi.fn(async () => undefined)}
        onUpdateProfile={vi.fn(async () => undefined)}
      />,
    );

    expect(html).toContain('class="chat-message__content"');
    expect(html).toContain('class="chat-avatar"');
    expect(html).toContain("Trả lời tin nhắn của Vinh");
    expect(html).toContain('class="chat-reply-quote"');
    expect(html).toContain("Xem video này nhé");
  });

  it("shows queue metadata, a clickable video and a compact remove action", () => {
    const html = renderToStaticMarkup(
      <RoomScreen
        snapshot={{
          ...snapshot,
          currentVideo: {
            videoId: "dQw4w9WgXcQ",
            state: "playing",
            positionSec: 0,
            changedAt: 1,
            version: 1,
          },
          queue: [{
            itemId: "queue-1",
            videoId: "aaaaaaaaaaa",
            title: "Video trong hàng chờ",
            channelTitle: "Kênh thử nghiệm",
            thumbnailUrl: "https://i.ytimg.com/test.jpg",
            addedBySessionId: "session-1",
            addedByName: "Vinh",
            addedAt: 2,
          }],
        }}
        sessionId="session-1"
        messages={[]}
        connected
        socket={null}
        onLeave={vi.fn(async () => undefined)}
        onAddVideo={vi.fn(async () => undefined)}
        onPlayVideoDirectly={vi.fn(async () => undefined)}
        onRemoveVideo={vi.fn(async () => undefined)}
        onPlayVideo={vi.fn(async () => undefined)}
        onCommand={vi.fn(async () => undefined)}
        onSendChat={vi.fn(async () => undefined)}
        onUpdateProfile={vi.fn(async () => undefined)}
      />,
    );

    expect(html).toContain('class="queue-thumbnail"');
    expect(html).toContain("Video trong hàng chờ");
    expect(html).toContain("Kênh thử nghiệm");
    expect(html).toContain('class="queue-video"');
    expect(html).toContain("Phát Video trong hàng chờ");
    expect(html).toContain('class="icon-action queue-remove"');
    expect(html).not.toContain("Phát ngay");
    expect(html).toContain("Bỏ qua");
  });

  it("opens the mobile chat tray without leaving the room screen", async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        media: "(max-width: 59.999rem)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <RoomScreen
          snapshot={snapshot}
          sessionId="session-1"
          messages={[]}
          connected
          socket={null}
          onLeave={vi.fn(async () => undefined)}
        onAddVideo={vi.fn(async () => undefined)}
        onPlayVideoDirectly={vi.fn(async () => undefined)}
          onRemoveVideo={vi.fn(async () => undefined)}
          onPlayVideo={vi.fn(async () => undefined)}
          onCommand={vi.fn(async () => undefined)}
          onSendChat={vi.fn(async () => undefined)}
          onUpdateProfile={vi.fn(async () => undefined)}
        />,
      );
    });

    const toggle = container.querySelector<HTMLButtonElement>(".mobile-chat-toggle");
    const chat = container.querySelector<HTMLElement>("#room-chat");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(chat?.getAttribute("aria-hidden")).toBe("true");

    await act(async () => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(chat?.getAttribute("aria-hidden")).toBe("false");
    expect(chat?.classList.contains("is-mobile-open")).toBe(true);

    act(() => root.unmount());
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });
});
