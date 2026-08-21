import { describe, expect, it } from "vitest";
import { MAX_VOICE_PARTICIPANTS, VoiceRegistry } from "./voice.registry";

describe("VoiceRegistry", () => {
  it("lists only voice peers from the same room", () => {
    const voice = new VoiceRegistry();
    voice.join({ socketId: "a", roomCode: "ROOMONE1", sessionId: "sa", name: "An" });
    const peers = voice.join({ socketId: "b", roomCode: "ROOMONE1", sessionId: "sb", name: "Bình" });
    voice.join({ socketId: "c", roomCode: "ROOMTWO2", sessionId: "sc", name: "Chi" });

    expect(peers).toEqual([{ socketId: "a", name: "An", muted: false }]);
    expect(voice.sameRoom("a", "b")).toBe(true);
    expect(voice.sameRoom("a", "c")).toBe(false);
  });

  it("updates mute state and removes peers", () => {
    const voice = new VoiceRegistry();
    voice.join({ socketId: "a", roomCode: "ROOMONE1", sessionId: "sa", name: "An" });

    expect(voice.setMuted("a", true).muted).toBe(true);
    expect(voice.leave("a")?.name).toBe("An");
    expect(voice.get("a")).toBeNull();
  });

  it("limits voice rooms to a safe mesh size", () => {
    const voice = new VoiceRegistry();
    for (let index = 0; index < MAX_VOICE_PARTICIPANTS; index += 1) {
      voice.join({
        socketId: `socket-${index}`,
        roomCode: "ROOMONE1",
        sessionId: `session-${index}`,
        name: `Member ${index}`,
      });
    }

    expect(() => voice.join({
      socketId: "overflow",
      roomCode: "ROOMONE1",
      sessionId: "overflow-session",
      name: "Overflow",
    })).toThrow("VOICE_FULL");
  });
});
