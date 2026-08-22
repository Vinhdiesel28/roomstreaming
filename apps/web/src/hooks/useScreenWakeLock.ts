import { useEffect, useState } from "react";

export type ScreenWakeLockStatus = "idle" | "active" | "unsupported";

export function useScreenWakeLock(active: boolean): ScreenWakeLockStatus {
  const [status, setStatus] = useState<ScreenWakeLockStatus>("idle");

  useEffect(() => {
    let cancelled = false;
    let sentinel: WakeLockSentinel | null = null;

    if (!("wakeLock" in navigator)) {
      setStatus(active ? "unsupported" : "idle");
      return;
    }

    const release = async () => {
      const current = sentinel;
      sentinel = null;
      if (current && !current.released) await current.release().catch(() => undefined);
      if (!cancelled) setStatus("idle");
    };

    const request = async () => {
      if (!active || document.visibilityState !== "visible" || sentinel) return;
      try {
        sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await sentinel.release().catch(() => undefined);
          sentinel = null;
          return;
        }
        setStatus("active");
        sentinel.addEventListener("release", () => {
          sentinel = null;
          if (!cancelled) setStatus("idle");
        }, { once: true });
      } catch {
        if (!cancelled) setStatus("idle");
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void request();
      else void release();
    };

    if (active) void request();
    else setStatus("idle");
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void release();
    };
  }, [active]);

  return status;
}
