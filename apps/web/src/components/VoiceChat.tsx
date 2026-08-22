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

export function VoiceChat({ socket, connected }: Props) {
  const voice = useVoiceChat(socket);
  const joined = voice.status === "joined";

  return (
    <section className="voice-card" aria-labelledby="voice-title">
      <div className="voice-card__heading">
        <h3 id="voice-title"><Radio size={17} /> Voice</h3>
        {joined && <span className="voice-count">{voice.participants.length + 1}/{voice.maxParticipants}</span>}
      </div>

      {voice.status === "idle" && (
        <button
          className="btn btn--ink btn--small voice-join"
          type="button"
          onClick={() => void voice.join()}
          disabled={!connected}
        >
          <Headphones size={18} /> {connected ? "Vào voice" : "Đang nối"}
        </button>
      )}

      {voice.status === "joining" && (
        <button className="btn btn--ink btn--small voice-join" type="button" disabled data-state="loading">
          <LoaderCircle className="spin" size={18} /> Đang vào
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
              aria-label={voice.muted ? "Bật micro" : "Tắt micro"}
            >
              {voice.muted ? <MicOff size={18} /> : <Mic size={18} />}
              {voice.muted ? "Bật mic" : "Tắt mic"}
            </button>
            <button className="btn btn--small voice-leave" type="button" onClick={() => void voice.leave()}>
              <PhoneOff size={18} /> Rời
            </button>
          </div>
        </>
      )}

      <div className="voice-audio-layer" aria-hidden="true">
        {voice.participants.map((peer) => (
          <RemoteAudio key={peer.socketId} stream={peer.stream} name={peer.name} />
        ))}
      </div>

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
