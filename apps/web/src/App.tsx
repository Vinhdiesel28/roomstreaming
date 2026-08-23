import { useCallback, useEffect, useState } from "react";
import { HomeScreen } from "./components/HomeScreen";
import { RoomScreen } from "./components/RoomScreen";
import { ServerWakeScreen } from "./components/ServerWakeScreen";
import { useWatchParty } from "./hooks/useWatchParty";

export function roomCodeFromPath(pathname = window.location.pathname) {
  return pathname.match(/^\/room\/([A-Z2-9]{8})\/?$/i)?.[1]?.toUpperCase() ?? "";
}

export function shouldRecoverRoomFromLink(routeCode: string, submittedCode: string) {
  return Boolean(routeCode && routeCode === submittedCode.toUpperCase());
}

function navigate(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export default function App() {
  const [routeCode, setRouteCode] = useState(roomCodeFromPath);
  const party = useWatchParty(routeCode);

  useEffect(() => {
    const onPopState = () => {
      const nextCode = roomCodeFromPath();
      setRouteCode(nextCode);
      if (!nextCode && party.snapshot) void party.leaveRoom();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [party]);

  const create = useCallback(async (name: string) => {
    const snapshot = await party.createRoom(name);
    navigate(`/room/${snapshot.roomCode}`);
  }, [party]);

  const join = useCallback(async (code: string, name: string) => {
    const openedFromRoomLink = shouldRecoverRoomFromLink(routeCode, code);
    const snapshot = await party.joinRoom(code, name, openedFromRoomLink);
    const roomPath = `/room/${snapshot.roomCode}`;
    if (window.location.pathname.toUpperCase() !== roomPath.toUpperCase()) navigate(roomPath);
  }, [party, routeCode]);

  const leave = useCallback(async () => {
    await party.leaveRoom();
    navigate("/");
  }, [party]);

  return (
    <div className="app-shell">
      <header className="nav-slab">
        <button className="brand" type="button" onClick={() => navigate("/")} aria-label="Về trang chủ">
          WATCH<span>ROOM</span><i aria-hidden="true" />
        </button>
        <p className="nav-promise">YouTube đúng nguồn · chat không lưu</p>
        <span className={`nav-status ${party.connected ? "is-online" : ""}`}>
          <span />{party.rejoining ? "Đang vào lại" : party.connected ? "Trực tuyến" : "Đang nối"}
        </span>
      </header>

      {!party.snapshot && (party.bootstrapping || party.rejoining) ? (
        <ServerWakeScreen rejoining={party.rejoining} roomCode={routeCode} />
      ) : party.snapshot ? (
        <RoomScreen
          snapshot={party.snapshot}
          sessionId={party.sessionId}
          messages={party.messages}
          connected={party.connected}
          socket={party.socket}
          onLeave={leave}
          onAddVideo={party.addVideo}
          onRemoveVideo={party.removeVideo}
          onPlayVideo={party.playQueuedVideo}
          onCommand={party.command}
          onSendChat={party.sendChat}
          onUpdateProfile={party.updateProfile}
        />
      ) : (
        <HomeScreen
          connected={party.connected}
          connecting={party.connecting}
          initialCode={routeCode}
          onCreate={create}
          onJoin={join}
          onCancelInvite={() => navigate("/")}
        />
      )}

      {party.error && !party.bootstrapping && <div className="toast" role="alert">{party.error}</div>}
      {party.notice && <div className="toast toast--notice" role="status">{party.notice}</div>}
      {!party.snapshot && (
        <footer className="foot-marquee" aria-label="Thông tin">
          <div className="foot-marquee__track" aria-hidden="true">
            <span>KHÔNG TÀI KHOẢN · KHÔNG LƯU CHAT · XEM TRỰC TIẾP TỪ YOUTUBE ·</span>
            <span>KHÔNG TÀI KHOẢN · KHÔNG LƯU CHAT · XEM TRỰC TIẾP TỪ YOUTUBE ·</span>
          </div>
          <p className="visually-hidden">Không tài khoản. Không lưu chat. Xem trực tiếp từ YouTube.</p>
        </footer>
      )}
    </div>
  );
}
