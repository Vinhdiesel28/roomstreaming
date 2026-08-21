import {
  Check,
  Copy,
  Crown,
  LoaderCircle,
  LogOut,
  MessageCircle,
  Plus,
  Search,
  Send,
  SkipForward,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { searchYouTube } from "../lib/api";
import type {
  ChatMessage,
  PlaybackCommand,
  RoomSnapshot,
  YouTubeSearchResult,
} from "../types";
import { YouTubePlayer } from "./YouTubePlayer";
import { VoiceChat } from "./VoiceChat";

interface Props {
  snapshot: RoomSnapshot;
  sessionId: string | null;
  messages: ChatMessage[];
  connected: boolean;
  socket: Socket | null;
  onLeave: () => Promise<void>;
  onAddVideo: (url: string) => Promise<unknown>;
  onRemoveVideo: (itemId: string) => Promise<unknown>;
  onCommand: (action: PlaybackCommand, positionSec?: number) => Promise<unknown>;
  onSendChat: (text: string) => Promise<unknown>;
}

export function RoomScreen({
  snapshot,
  sessionId,
  messages,
  connected,
  socket,
  onLeave,
  onAddVideo,
  onRemoveVideo,
  onCommand,
  onSendChat,
}: Props) {
  const [videoUrl, setVideoUrl] = useState("");
  const [videoSource, setVideoSource] = useState<"link" | "search">("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<YouTubeSearchResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [addingVideoId, setAddingVideoId] = useState<string | null>(null);
  const [addedVideoId, setAddedVideoId] = useState<string | null>(null);
  const [chat, setChat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  const addVideo = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onAddVideo(videoUrl);
      setVideoUrl("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể thêm video.");
    } finally {
      setBusy(false);
    }
  };

  const sendChat = async (event: FormEvent) => {
    event.preventDefault();
    const text = chat.trim();
    if (!text) return;
    setChat("");
    try {
      await onSendChat(text);
    } catch (cause) {
      setChat(text);
      setError(cause instanceof Error ? cause.message : "Không gửi được tin nhắn.");
    }
  };

  const findVideos = async (event: FormEvent) => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchError("Nhập ít nhất 2 ký tự để tìm video.");
      return;
    }
    setSearchBusy(true);
    setSearchError(null);
    setAddedVideoId(null);
    setSearchResults([]);
    try {
      const items = await searchYouTube(query);
      setSearchResults(items);
      if (items.length === 0) {
        setSearchError("Không có kết quả có thể phát nhúng. Hãy thử từ khóa khác.");
      }
    } catch (cause) {
      setSearchError(cause instanceof Error ? cause.message : "Không tìm được video YouTube.");
    } finally {
      setSearchBusy(false);
    }
  };

  const addSearchResult = async (result: YouTubeSearchResult) => {
    setAddingVideoId(result.videoId);
    setAddedVideoId(null);
    setSearchError(null);
    try {
      await onAddVideo(result.videoId);
      setAddedVideoId(result.videoId);
    } catch (cause) {
      setSearchError(cause instanceof Error ? cause.message : "Không thể thêm video.");
    } finally {
      setAddingVideoId(null);
    }
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/room/${snapshot.roomCode}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_500);
  };

  return (
    <main className="room-shell">
      <section className="room-topbar">
        <div className="room-code-block">
          <span>Phòng</span>
          <strong>{snapshot.roomCode}</strong>
          <button className="icon-action copy-action" type="button" onClick={copyLink} aria-label="Sao chép link phòng">
            <Copy size={18} /><span>{copied ? "Đã chép" : "Chép link"}</span>
          </button>
        </div>
        <div className="room-topbar__right">
          <span className={`status-chip ${connected ? "is-online" : ""}`}>
            <span />{connected ? "Đã nối" : "Đang nối lại"}
          </span>
          <button className="btn btn--soft btn--small" type="button" onClick={() => void onLeave()}>
            <LogOut size={17} /> Rời phòng
          </button>
        </div>
      </section>

      <div className="room-grid">
        <section className="video-picker" aria-labelledby="video-picker-title">
          <div className="panel-heading video-picker__heading">
            <div>
              <h2 id="video-picker-title">Chọn video</h2>
              <p>Tìm trên YouTube hoặc dán link để thêm vào phòng.</p>
            </div>
          </div>
          <div className="video-picker__body">
            <div className="video-source-switch" aria-label="Cách thêm video">
              <button
                type="button"
                aria-pressed={videoSource === "link"}
                onClick={() => {
                  setVideoSource("link");
                  setSearchError(null);
                }}
              >
                <Plus size={16} /> Dán link
              </button>
              <button
                type="button"
                aria-pressed={videoSource === "search"}
                onClick={() => {
                  setVideoSource("search");
                  setError(null);
                }}
              >
                <Search size={16} /> Tìm video
              </button>
            </div>

            {videoSource === "link" ? (
              <form className="add-video" onSubmit={addVideo}>
                <label htmlFor="youtube-url">Link YouTube</label>
                <div className="inline-field">
                  <input
                    id="youtube-url"
                    type="url"
                    value={videoUrl}
                    onChange={(event) => setVideoUrl(event.target.value)}
                    placeholder="https://youtu.be/…"
                    required
                    aria-invalid={Boolean(error)}
                    aria-describedby="youtube-url-error"
                  />
                  <button
                    className="icon-action icon-action--add"
                    type="submit"
                    disabled={busy}
                    data-state={busy ? "loading" : undefined}
                    aria-label={busy ? "Đang thêm video" : "Thêm video"}
                  >
                    {busy ? <LoaderCircle className="spin" size={20} /> : <Plus size={20} />}
                  </button>
                </div>
                <p
                  className={`field-helper ${error ? "is-error" : ""}`}
                  id="youtube-url-error"
                  role={error ? "alert" : undefined}
                >
                  {error ?? "Hỗ trợ link video, Shorts, Live và youtu.be."}
                </p>
              </form>
            ) : (
              <div className="youtube-search">
                <form className="add-video" onSubmit={findVideos}>
                  <label htmlFor="youtube-search">Tìm trên YouTube</label>
                  <div className="inline-field">
                    <input
                      id="youtube-search"
                      type="search"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Tên bài hát, video…"
                      maxLength={100}
                      autoComplete="off"
                      aria-invalid={Boolean(searchError)}
                      aria-describedby="youtube-search-helper"
                    />
                    <button
                      className="icon-action icon-action--add"
                      type="submit"
                      disabled={searchBusy || searchQuery.trim().length < 2}
                      data-state={searchBusy ? "loading" : undefined}
                      aria-label={searchBusy ? "Đang tìm video" : "Tìm video"}
                    >
                      {searchBusy ? <LoaderCircle className="spin" size={20} /> : <Search size={19} />}
                    </button>
                  </div>
                  <p
                    className={`field-helper ${searchError ? "is-error" : ""}`}
                    id="youtube-search-helper"
                    role={searchError ? "alert" : undefined}
                  >
                    {searchError ?? "Tìm tối đa 8 video có thể phát trong trang."}
                  </p>
                </form>
                <p className="visually-hidden" aria-live="polite">
                  {searchBusy ? "Đang tìm video" : `${searchResults.length} kết quả tìm kiếm`}
                </p>
                <ul className="search-results" aria-busy={searchBusy}>
                  {searchResults.map((result) => {
                    const isAdding = addingVideoId === result.videoId;
                    const isAdded = addedVideoId === result.videoId;
                    return (
                      <li className="search-result" key={result.videoId}>
                        <img
                          src={result.thumbnailUrl}
                          alt=""
                          width="120"
                          height="68"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                        <div className="search-result__copy">
                          <strong>{result.title}</strong>
                          <span>{result.channelTitle}</span>
                        </div>
                        <button
                          className="icon-action icon-action--quiet search-result__add"
                          type="button"
                          onClick={() => void addSearchResult(result)}
                          disabled={Boolean(addingVideoId) || isAdded}
                          data-state={isAdding ? "loading" : isAdded ? "success" : undefined}
                          aria-label={isAdded ? `Đã thêm ${result.title}` : `Thêm ${result.title}`}
                        >
                          {isAdding ? <LoaderCircle className="spin" size={18} /> : isAdded ? <Check size={18} /> : <Plus size={18} />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </section>

        <section className="video-stage">
          <YouTubePlayer playback={snapshot.currentVideo} isHost={snapshot.isHost} onCommand={onCommand} />
          <div className="video-meta">
            <div>
              <span className="role-line">
                {snapshot.isHost ? <><Crown size={16} /> Bạn là Host</> : <><UserRound size={16} /> Host đang giữ nhịp</>}
              </span>
              <p>{snapshot.isHost ? "Dùng player YouTube để phát, dừng hoặc tua." : "Thao tác cục bộ sẽ tự bắt nhịp lại với Host."}</p>
            </div>
            {snapshot.isHost && snapshot.currentVideo && (
              <button className="btn btn--soft btn--small" type="button" onClick={() => void onCommand("NEXT", 0)}>
                <SkipForward size={17} /> Video tiếp
              </button>
            )}
          </div>
        </section>

        <section className="chat-panel">
          <div className="panel-heading panel-heading--compact">
            <div><h2>Trò chuyện</h2><p><MessageCircle size={15} /> Không lưu lịch sử</p></div>
          </div>
          <div className="chat-log" aria-live="polite">
            {messages.length === 0 ? (
              <div className="chat-empty"><MessageCircle size={22} /><p>Tin nhắn chỉ tồn tại trong phiên này.</p></div>
            ) : messages.map((message) => (
              <article className={`chat-message ${message.senderSessionId === sessionId ? "is-mine" : ""}`} key={message.id}>
                <div><strong>{message.senderName}</strong><time dateTime={new Date(message.sentAt).toISOString()}>{new Date(message.sentAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</time></div>
                <p>{message.text}</p>
              </article>
            ))}
            <div ref={chatEndRef} />
          </div>
          <form className="chat-form" onSubmit={sendChat}>
            <label className="visually-hidden" htmlFor="chat-message">Tin nhắn</label>
            <input
              id="chat-message"
              value={chat}
              onChange={(event) => setChat(event.target.value)}
              placeholder="Nhắn cho cả phòng…"
              maxLength={500}
              autoComplete="off"
            />
            <button className="icon-action icon-action--send" type="submit" disabled={!chat.trim()} aria-label="Gửi tin nhắn">
              <Send size={19} />
            </button>
          </form>
        </section>

        <VoiceChat socket={socket} connected={connected} />

        <aside className="queue-panel">
          <div className="panel-heading">
            <div><h2>Hàng chờ</h2><p>{snapshot.queue.length}/50 video</p></div>
            <span className="count-badge">{snapshot.queue.length}</span>
          </div>
          <ol className="queue-list">
            {snapshot.queue.length === 0 ? (
              <li className="queue-empty">Chưa có video tiếp theo.</li>
            ) : snapshot.queue.map((item, index) => {
              const canRemove = snapshot.isHost || item.addedBySessionId === sessionId;
              return (
                <li className="queue-item" key={item.itemId}>
                  <span className="queue-index">{String(index + 1).padStart(2, "0")}</span>
                  <div className="queue-copy">
                    <strong>YouTube · {item.videoId}</strong>
                    <span>Thêm bởi {item.addedByName}</span>
                  </div>
                  {canRemove && (
                    <button
                      className="icon-action icon-action--quiet"
                      type="button"
                      onClick={() => void onRemoveVideo(item.itemId).catch((cause) => setError(cause instanceof Error ? cause.message : "Không xóa được video."))}
                      aria-label="Xóa khỏi hàng chờ"
                    >
                      <Trash2 size={17} />
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </aside>

        <section className="members-panel">
          <div className="panel-heading panel-heading--compact">
            <div><h2>Trong phòng</h2><p><Users size={15} /> {snapshot.members.length} người</p></div>
          </div>
          <ul className="member-list">
            {snapshot.members.map((member) => (
              <li key={member.sessionId}>
                <span className="avatar" aria-hidden="true">{member.name.slice(0, 1).toUpperCase()}</span>
                <span className="member-name">{member.name}{member.sessionId === sessionId ? " (bạn)" : ""}</span>
                {member.isHost && <span className="host-badge"><Crown size={13} /> Host</span>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
