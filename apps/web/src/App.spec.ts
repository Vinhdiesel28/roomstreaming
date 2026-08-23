import { describe, expect, it } from "vitest";
import { roomCodeFromPath, shouldRecoverRoomFromLink } from "./App";

describe("roomCodeFromPath", () => {
  it("reads an invitation code from a room URL", () => {
    expect(roomCodeFromPath("/room/abcd2345")).toBe("ABCD2345");
    expect(roomCodeFromPath("/room/ABCD2345/")).toBe("ABCD2345");
  });

  it("ignores non-room URLs", () => {
    expect(roomCodeFromPath("/")).toBe("");
    expect(roomCodeFromPath("/room/short")).toBe("");
  });
});

describe("shouldRecoverRoomFromLink", () => {
  it("only recreates a missing room when the code came from the current invitation URL", () => {
    expect(shouldRecoverRoomFromLink("ABCD2345", "abcd2345")).toBe(true);
    expect(shouldRecoverRoomFromLink("", "ABCD2345")).toBe(false);
    expect(shouldRecoverRoomFromLink("ABCD2345", "WXYZ6789")).toBe(false);
  });
});
