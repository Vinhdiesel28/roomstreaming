// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveActiveRoomSession } from "../lib/roomSession";
import type { RoomSnapshot } from "../types";
import { useWatchParty } from "./useWatchParty";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const socketMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const snapshot: RoomSnapshot = {
    roomCode: "ABCD2345",
    hostSessionId: "session-1",
    isHost: true,
    currentVideo: null,
    queue: [],
    queueVersion: 0,
    members: [{
      sessionId: "session-1",
      name: "Vinh",
      avatarUrl: null,
      joinedAt: 1,
      online: true,
      isHost: true,
    }],
    serverTime: 1,
  };
  const socket: Record<string, unknown> = {
    id: undefined,
    connected: false,
    active: true,
    auth: {},
  };
  socket.on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    handlers.set(event, handler);
    return socket;
  });
  socket.timeout = vi.fn(() => socket);
  socket.emit = vi.fn((event: string, payload: unknown, callback: (...args: unknown[]) => void) => {
    emitted.push({ event, payload });
    if (event === "room:resume") {
      callback(null, { ok: true, data: { snapshot, recovered: false } });
    }
    return socket;
  });
  socket.connect = vi.fn(() => {
    socket.id = `socket-${Number(String(socket.id ?? "socket-0").split("-")[1]) + 1}`;
    socket.connected = true;
    handlers.get("connect")?.();
    handlers.get("session:ready")?.({ sessionId: "session-1" });
    return socket;
  });
  socket.disconnect = vi.fn(() => {
    socket.connected = false;
    return socket;
  });
  return { emitted, handlers, snapshot, socket };
});

vi.mock("socket.io-client", () => ({ io: vi.fn(() => socketMocks.socket) }));
vi.mock("../lib/api", () => ({
  apiUrl: () => "http://localhost:3001",
  getSessionToken: vi.fn(async () => "session-token"),
  resetSessionToken: vi.fn(),
}));

describe("useWatchParty reconnect", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    socketMocks.emitted.length = 0;
    socketMocks.handlers.clear();
    socketMocks.socket.id = undefined;
    socketMocks.socket.connected = false;
  });

  it("automatically resumes the saved room on startup and reconnect", async () => {
    saveActiveRoomSession("ABCD2345", "Vinh");
    let latest = null as unknown as ReturnType<typeof useWatchParty>;
    function Probe() {
      latest = useWatchParty("ABCD2345");
      return null;
    }

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(socketMocks.emitted.filter((item) => item.event === "room:resume")).toHaveLength(1);
    expect(socketMocks.emitted[0]?.payload).toMatchObject({ roomCode: "ABCD2345", name: "Vinh" });
    expect(latest.snapshot?.roomCode).toBe("ABCD2345");

    await act(async () => {
      socketMocks.socket.connected = false;
      socketMocks.handlers.get("disconnect")?.("transport close");
      (socketMocks.socket.connect as () => void)();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(socketMocks.emitted.filter((item) => item.event === "room:resume")).toHaveLength(2);
    expect(latest.rejoining).toBe(false);
    act(() => root.unmount());
  });
});
