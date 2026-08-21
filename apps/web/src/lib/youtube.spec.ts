import { describe, expect, it, vi } from "vitest";
import { expectedPosition } from "./youtube";

describe("expectedPosition", () => {
  it("keeps paused video still", () => {
    expect(expectedPosition({ state: "paused", positionSec: 42, changedAt: 0 })).toBe(42);
  });

  it("advances a playing video using server time", () => {
    vi.setSystemTime(10_000);
    expect(expectedPosition({ state: "playing", positionSec: 5, changedAt: 8_000 })).toBe(7);
    vi.useRealTimers();
  });
});
