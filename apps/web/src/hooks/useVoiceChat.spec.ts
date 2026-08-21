import { describe, expect, it } from "vitest";
import { buildIceServers } from "./useVoiceChat";

describe("buildIceServers", () => {
  it("always includes public STUN discovery", () => {
    expect(buildIceServers()[0]?.urls).toEqual([
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
    ]);
  });

  it("adds an authenticated TURN relay when configured", () => {
    expect(
      buildIceServers({
        url: "turn:relay.example.com:3478",
        username: "watchroom",
        credential: "secret",
      }),
    ).toContainEqual({
      urls: "turn:relay.example.com:3478",
      username: "watchroom",
      credential: "secret",
    });
  });

  it("ignores an empty TURN URL", () => {
    expect(buildIceServers({ url: "   " })).toHaveLength(1);
  });
});
