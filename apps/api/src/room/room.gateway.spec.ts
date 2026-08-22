import { describe, expect, it } from "vitest";
import { parseAvatarUrl, parseChatReply } from "./room.gateway";

describe("parseChatReply", () => {
  it("normalizes a valid reply quote", () => {
    expect(parseChatReply({
      messageId: " message-1 ",
      senderName: " Vinh ",
      text: " Xem video này nhé ",
    })).toEqual({
      messageId: "message-1",
      senderName: "Vinh",
      text: "Xem video này nhé",
    });
  });

  it("rejects malformed or oversized reply quotes", () => {
    expect(parseChatReply({ messageId: "", senderName: "Vinh", text: "Tin nhắn" })).toBeUndefined();
    expect(parseChatReply({ messageId: "message-1", senderName: "Vinh", text: "x".repeat(501) })).toBeUndefined();
    expect(parseChatReply("message-1")).toBeUndefined();
  });
});

describe("parseAvatarUrl", () => {
  it("accepts compressed raster data URLs and an empty avatar", () => {
    expect(parseAvatarUrl("data:image/jpeg;base64,AAAA")).toBe("data:image/jpeg;base64,AAAA");
    expect(parseAvatarUrl(null)).toBeNull();
  });

  it("rejects SVG, remote URLs and oversized payloads", () => {
    expect(() => parseAvatarUrl("data:image/svg+xml;base64,AAAA")).toThrow("INVALID_AVATAR");
    expect(() => parseAvatarUrl("https://example.com/avatar.png")).toThrow("INVALID_AVATAR");
    expect(() => parseAvatarUrl(`data:image/png;base64,${"A".repeat(60_000)}`)).toThrow("INVALID_AVATAR");
  });
});
