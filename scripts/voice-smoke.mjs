import assert from "node:assert/strict";
import { io } from "socket.io-client";

const apiUrl = process.env.API_URL ?? "http://localhost:3001";

async function sessionToken() {
  const response = await fetch(`${apiUrl}/api/session`, { method: "POST" });
  assert.equal(response.ok, true, "session endpoint is unavailable");
  return (await response.json()).token;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(apiUrl, { auth: { token }, transports: ["websocket"] });
    const timer = setTimeout(() => reject(new Error("socket connection timed out")), 8_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("connect_error", reject);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const callback = (response) => {
      if (!response?.ok) reject(new Error(response?.error?.message ?? `${event} failed`));
      else resolve(response.data);
    };
    if (payload === undefined) socket.emit(event, callback);
    else socket.emit(event, payload, callback);
  });
}

function once(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 5_000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const sockets = [];
try {
  const [firstToken, secondToken] = await Promise.all([sessionToken(), sessionToken()]);
  const [first, second] = await Promise.all([connect(firstToken), connect(secondToken)]);
  sockets.push(first, second);

  const room = await emitAck(first, "room:create", { name: "Smoke A" });
  await emitAck(second, "room:join", { roomCode: room.roomCode, name: "Smoke B" });

  const firstVoice = await emitAck(first, "voice:join");
  const peerJoined = once(first, "voice:peer-joined");
  const secondVoice = await emitAck(second, "voice:join");
  const announcedPeer = await peerJoined;
  assert.equal(firstVoice.peers.length, 0);
  assert.equal(secondVoice.peers.length, 1);
  assert.equal(announcedPeer.socketId, second.id);

  const relayedSignal = once(first, "voice:signal");
  await emitAck(second, "voice:signal", {
    targetSocketId: first.id,
    description: { type: "offer", sdp: "v=0\r\n" },
  });
  const signal = await relayedSignal;
  assert.equal(signal.source.socketId, second.id);
  assert.equal(signal.description.type, "offer");

  const mutedEvent = once(first, "voice:peer-muted");
  await emitAck(second, "voice:mute", { muted: true });
  assert.equal((await mutedEvent).muted, true);

  const leftEvent = once(first, "voice:peer-left");
  await emitAck(second, "voice:leave");
  assert.equal((await leftEvent).socketId, second.id);
  console.log("Voice signaling smoke test passed.");
} finally {
  for (const socket of sockets) socket.disconnect();
}
