import { describe, expect, it } from "vitest";
import { parseChatReply } from "./room.gateway";

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
