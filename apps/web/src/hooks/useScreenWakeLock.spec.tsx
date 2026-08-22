// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useScreenWakeLock, type ScreenWakeLockStatus } from "./useScreenWakeLock";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("useScreenWakeLock", () => {
  const originalWakeLock = navigator.wakeLock;

  afterEach(() => {
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: originalWakeLock,
    });
  });

  it("requests and releases the screen lock while playback is active", async () => {
    const release = vi.fn(async () => undefined);
    const sentinel = new EventTarget() as WakeLockSentinel;
    Object.defineProperties(sentinel, {
      released: { configurable: true, value: false },
      release: { configurable: true, value: release },
      type: { configurable: true, value: "screen" },
    });
    const request = vi.fn(async () => sentinel);
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request },
    });

    const statuses: ScreenWakeLockStatus[] = [];
    function Probe({ active }: { active: boolean }) {
      statuses.push(useScreenWakeLock(active));
      return null;
    }

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe active />));
    expect(request).toHaveBeenCalledWith("screen");
    expect(statuses).toContain("active");

    await act(async () => root.render(<Probe active={false} />));
    expect(release).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
