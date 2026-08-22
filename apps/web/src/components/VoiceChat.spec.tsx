import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VoiceChat } from "./VoiceChat";

vi.mock("../hooks/useVoiceChat", () => ({
  useVoiceChat: () => ({
    status: "joined",
    muted: false,
    maxParticipants: 8,
    participants: [{
      socketId: "peer-1",
      name: "Người bạn",
      muted: false,
      connectionState: "connected",
      stream: undefined,
    }],
    error: null,
    join: vi.fn(),
    leave: vi.fn(),
    toggleMute: vi.fn(),
    clearError: vi.fn(),
  }),
}));

describe("VoiceChat compact controls", () => {
  it("keeps only mute and leave buttons visible after joining", () => {
    const html = renderToStaticMarkup(<VoiceChat socket={null} connected />);

    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain("Tắt mic");
    expect(html).toContain("Rời");
    expect(html).toContain("2/8");
    expect(html).not.toContain("Mic đang bật");
    expect(html).not.toContain("Người bạn</strong>");
  });
});
