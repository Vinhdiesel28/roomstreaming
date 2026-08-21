import { describe, expect, it } from "vitest";
import { roomCodeFromPath } from "./App";

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
