import {
  Headphones,
  LoaderCircle,
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import type { Socket } from "socket.io-client";
import { useVoiceChat } from "../hooks/useVoiceChat";

interface Props {
  socket: Socket | null;
  connected: boolean;
}

function RemoteAudio({ stream, name }: { stream?: MediaStream; name: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !stream) return;
    audio.srcObject = stream;
    void audio.play().catch(() => undefined);
    return () => {
      audio.srcObject = null;
    };
  }, [stream]);

  return <audio ref={audioRef} autoPlay playsInline aria-label={`Âm thanh của ${name}`} />;
}

function connectionLabel(state: RTCPeerConnectionState | "waiting") {
  if (state === "connected") return "Đã nối";
  if (state === "failed" || state === "disconnected") return "Mất nối";
  return "Đang nối";
}

export function VoiceChat({ socket, connected }: Props) {
  const voice = useVoiceChat(socket);
  const joined = voice.status === "joined";

  return (
    <section className="voice-card" aria-labelledby="voice-title">
      <div className="voice-card__heading">
        <div>
          <h3 id="voice-title"><Radio size={17} /> Voice chat</h3>
          <p>Không ghi âm · tối đa {voice.maxParticipants} người</p>
        </div>
        {joined && <span className="voice-live"><span /> Đang vào voice</span>}
      </div>

      {voice.status === "idle" && (
        <button
          className="btn btn--ink btn--small voice-join"
          type="button"
          onClick={() => void voice.join()}
          disabled={!connected}
        >
          <Headphones size={18} /> {connected ? "Tham gia voice" : "Chờ kết nối"}
        </button>
      )}

      {voice.status === "joining" && (
        <button className="btn btn--ink btn--small voice-join" type="button" disabled data-state="loading">
          <LoaderCircle className="spin" size={18} /> Đang xin quyền micro
        </button>
      )}

      {joined && (
        <>
          <div className="voice-controls" aria-label="Điều khiển voice chat">
            <button
              className="btn btn--soft btn--small"
              type="button"
              onClick={() => void voice.toggleMute()}
              aria-pressed={voice.muted}
            >
              {voice.muted ? <MicOff size={18} /> : <Mic size={18} />}
              {voice.muted ? "Bật mic" : "Tắt mic"}
            </button>
            <button className="btn btn--small voice-leave" type="button" onClick={() => void voice.leave()}>
              <PhoneOff size={18} /> Rời voice
            </button>
          </div>

          <ul className="voice-participants" aria-label="Người đang trong voice">
            <li>
              <span className={`voice-mic ${voice.muted ? "is-muted" : ""}`} aria-hidden="true">
                {voice.muted ? <MicOff size={15} /> : <Mic size={15} />}
              </span>
              <strong>Bạn</strong>
              <span>{voice.muted ? "Đã tắt mic" : "Mic đang bật"}</span>
            </li>
            {voice.participants.map((peer) => (
              <li key={peer.socketId}>
                <RemoteAudio stream={peer.stream} name={peer.name} />
                <span className={`voice-mic ${peer.muted ? "is-muted" : ""}`} aria-hidden="true">
                  {peer.muted ? <MicOff size={15} /> : <Mic size={15} />}
                </span>
                <strong>{peer.name}</strong>
                <span>{peer.muted ? "Đã tắt mic" : connectionLabel(peer.connectionState)}</span>
              </li>
            ))}
          </ul>
          {voice.participants.length === 0 && (
            <p className="voice-empty">Bạn đang ở đây một mình. Mời người khác bằng link phòng.</p>
          )}
        </>
      )}

      {voice.error && (
        <div className="voice-error" role="alert">
          <p>{voice.error}</p>
          <button type="button" onClick={voice.clearError} aria-label="Đóng thông báo lỗi voice">
            <X size={16} />
          </button>
        </div>
      )}
    </section>
  );
}
