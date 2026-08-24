import {
  Check,
  CircleAlert,
  Copy,
  Crown,
  ListVideo,
  LoaderCircle,
  LogOut,
  MessageCircle,
  Play,
  Plus,
  Reply,
  Search,
  Send,
  Settings2,
  SkipForward,
  Sun,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { useScreenWakeLock } from "../hooks/useScreenWakeLock";
import { getSimilarYouTubeVideos, searchYouTube } from "../lib/api";
import { loadBrowserProfile, saveBrowserProfile, type BrowserProfile } from "../lib/profile";
import type {
  ChatMessage,
  ChatReply,
  PlaybackCommand,
  RoomSnapshot,
  SharedProfile,
  YouTubeSearchResult,
} from "../types";
import { ProfileDialog } from "./ProfileDialog";
import { YouTubePlayer } from "./YouTubePlayer";
import { VoiceChat } from "./VoiceChat";

const MAX_RECOMMENDATION_EXCLUSIONS = 100;
const MAX_SEEN_RECOMMENDATIONS = 60;

interface Props {
  snapshot: RoomSnapshot;
  sessionId: string | null;
  messages: ChatMessage[];
  connected: boolean;
  socket: Socket | null;
  onLeave: () => Promise<void>;
  onAddVideo: (url: string, queueOnly?: boolean) => Promise<unknown>;
  onPlayVideoDirectly: (url: string) => Promise<unknown>;
  onRemoveVideo: (itemId: string) => Promise<unknown>;
  onPlayVideo: (itemId: string) => Promise<unknown>;
  onCommand: (action: PlaybackCommand, positionSec?: number) => Promise<unknown>;
  onSendChat: (text: string, replyTo?: ChatReply) => Promise<unknown>;
  onUpdateProfile: (profile: SharedProfile) => Promise<unknown>;
}

type VideoResultState = "idle" | "loading" | "success" | "error";

interface VideoResultRowProps {
  result: YouTubeSearchResult;
  state: VideoResultState;
  interactionDisabled: boolean;
  canPlayNow: boolean;
  playing: boolean;
  onPlay: () => void;
  onAdd: () => void;
}

export function VideoResultRow({
  result,
  state,
  interactionDisabled,
  canPlayNow,
  playing,
  onPlay,
  onAdd,
}: VideoResultRowProps) {
  const addLabel = state === "loading"
    ? `Đang thêm ${result.title}`
    : state === "success"
      ? `Đã thêm ${result.title}`
      : state === "error"
        ? `Thử thêm lại ${result.title}`
        : `Thêm ${result.title} vào hàng chờ`;

  return (
    <li className="search-result" data-state={state === "idle" ? undefined : state}>
      <button
        className="search-result__main"
        type="button"
        onClick={onPlay}
        disabled={!canPlayNow || interactionDisabled}
        aria-label={canPlayNow ? `Phát ngay ${result.title}` : `Chỉ Host có thể phát ${result.title}`}
        title={canPlayNow ? "Phát ngay" : "Chỉ Host được phát ngay"}
      >
        <img
          src={result.thumbnailUrl}
          alt=""
          width="120"
          height="68"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
        <span className="search-result__copy">
          <strong>{result.title}</strong>
          <span>{result.channelTitle}</span>
        </span>
        <span className="search-result__play" aria-hidden="true">
          {playing ? <LoaderCircle className="spin" size={18} /> : <Play size={18} />}
        </span>
      </button>
      <button
        className="search-result__add"
        type="button"
        onClick={onAdd}
        disabled={interactionDisabled || state === "success"}
        aria-label={addLabel}
        title="Thêm vào hàng chờ"
      >
        <span className="search-result__status" aria-hidden="true">
          {state === "loading" ? (
            <LoaderCircle className="spin" size={18} />
          ) : state === "success" ? (
            <Check size={18} />
          ) : state === "error" ? (
            <CircleAlert size={18} />
          ) : (
            <Plus size={18} />
          )}
        </span>
      </button>
    </li>
  );
}

export function RoomScreen({
  snapshot,
  sessionId,
  messages,
  connected,
  socket,
  onLeave,
  onAddVideo,
  onPlayVideoDirectly,
  onRemoveVideo,
  onPlayVideo,
  onCommand,
  onSendChat,
  onUpdateProfile,
}: Props) {
  const [videoUrl, setVideoUrl] = useState("");
  const [videoSource, setVideoSource] = useState<"link" | "search">("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<YouTubeSearchResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [addingVideoId, setAddingVideoId] = useState<string | null>(null);
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  const [addedVideoId, setAddedVideoId] = useState<string | null>(null);
  const [failedVideoId, setFailedVideoId] = useState<string | null>(null);
  const [similarResults, setSimilarResults] = useState<YouTubeSearchResult[]>([]);
  const [similarBusy, setSimilarBusy] = useState(false);
  const [similarError, setSimilarError] = useState<string | null>(null);
  const [chat, setChat] = useState("");
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [queueBusyItemId, setQueueBusyItemId] = useState<string | null>(null);
  const [skipBusy, setSkipBusy] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSyncWarning, setProfileSyncWarning] = useState<string | null>(null);
  const [profile, setProfile] = useState<BrowserProfile>(() => {
    const stored = loadBrowserProfile();
    const roomName = snapshot.members.find((member) => member.sessionId === sessionId)?.name ?? "";
    return { ...stored, name: stored.name || roomName };
  });
  const [isCompactLayout, setIsCompactLayout] = useState(() =>
    typeof window.matchMedia === "function" && window.matchMedia("(max-width: 59.999rem)").matches,
  );
  const [lastReadMessageCount, setLastReadMessageCount] = useState(messages.length);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const shownRecommendationIdsRef = useRef(new Set<string>());
  const wakeLockStatus = useScreenWakeLock(snapshot.currentVideo?.state === "playing");
  const unreadMessageCount = Math.max(0, messages.length - lastReadMessageCount);
  const recommendationContextVideoIds = [...new Set([
    ...(snapshot.recentVideoIds ?? []),
    ...snapshot.queue.slice(-2).map((item) => item.videoId),
  ])]
    .filter((videoId) => videoId !== snapshot.currentVideo?.videoId)
    .slice(0, 4);
  const recommendationExcludedVideoIds = [...new Set([
    snapshot.currentVideo?.videoId,
    ...snapshot.queue.map((item) => item.videoId),
    ...(snapshot.recentVideoIds ?? []),
    ...(snapshot.skippedVideoIds ?? []),
  ].filter((videoId): videoId is string => Boolean(videoId)))]
    .slice(0, MAX_RECOMMENDATION_EXCLUSIONS);
  const recommendationContextKey = recommendationContextVideoIds.join(",");
  const recommendationExcludedKey = recommendationExcludedVideoIds.join(",");

  const saveProfile = async (nextProfile: BrowserProfile) => {
    const saved = saveBrowserProfile(nextProfile);
    setProfile(saved);
    setProfileSyncWarning(null);
    void Promise.resolve()
      .then(() => onUpdateProfile({ name: saved.name, avatarUrl: saved.avatarUrl }))
      .then(() => setProfileSyncWarning(null))
      .catch(() => setProfileSyncWarning(
        "Đã lưu trên thiết bị này. API chưa đồng bộ nên bạn bè có thể chưa thấy avatar mới.",
      ));
  };

  useEffect(() => {
    shownRecommendationIdsRef.current.clear();
  }, [snapshot.roomCode]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 59.999rem)");
    const update = () => setIsCompactLayout(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (chatOpen || !isCompactLayout) setLastReadMessageCount(messages.length);
  }, [chatOpen, isCompactLayout, messages.length]);

  useEffect(() => {
    if (!chatOpen || !isCompactLayout) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setChatOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [chatOpen, isCompactLayout]);

  useEffect(() => {
    if (isCompactLayout && !chatOpen) return;
    chatEndRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [chatOpen, isCompactLayout, messages]);

  useEffect(() => {
    let cancelled = false;
    const videoId = snapshot.currentVideo?.videoId;

    setSimilarResults([]);
    setSimilarError(null);
    setSimilarBusy(Boolean(videoId));
    setAddedVideoId(null);
    setFailedVideoId(null);

    if (!videoId) {
      return () => {
        cancelled = true;
      };
    }

    const loadSimilarVideos = async () => {
      try {
        const previouslyShownVideoIds = [...shownRecommendationIdsRef.current]
          .slice(-MAX_SEEN_RECOMMENDATIONS);
        const excludedVideoIds = [...new Set([
          ...recommendationExcludedVideoIds,
          ...previouslyShownVideoIds,
        ])].slice(0, MAX_RECOMMENDATION_EXCLUSIONS);
        const [items] = await Promise.all([
          getSimilarYouTubeVideos(
            videoId,
            recommendationContextVideoIds,
            excludedVideoIds,
          ),
          new Promise((resolve) => window.setTimeout(resolve, 300)),
        ]);
        if (cancelled) return;
        setSimilarResults(items);
        for (const item of items) shownRecommendationIdsRef.current.add(item.videoId);
        while (shownRecommendationIdsRef.current.size > MAX_SEEN_RECOMMENDATIONS) {
          const oldestVideoId = shownRecommendationIdsRef.current.values().next().value;
          if (!oldestVideoId) break;
          shownRecommendationIdsRef.current.delete(oldestVideoId);
        }
        if (items.length === 0) {
          setSimilarError("Chưa tìm được bài phù hợp có thể phát trong phòng.");
        }
      } catch (cause) {
        if (cancelled) return;
        setSimilarError(cause instanceof Error ? cause.message : "Không lấy được gợi ý video.");
      } finally {
        if (!cancelled) setSimilarBusy(false);
      }
    };

    void loadSimilarVideos();
    return () => {
      cancelled = true;
    };
  }, [snapshot.currentVideo?.videoId, recommendationContextKey, recommendationExcludedKey]);

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
      const replyTo = replyingTo ? {
        messageId: replyingTo.id,
        senderName: replyingTo.senderName,
        text: replyingTo.text,
      } : undefined;
      await onSendChat(text, replyTo);
      setReplyingTo(null);
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
    setFailedVideoId(null);
    setSearchError(null);
    try {
      await onAddVideo(result.videoId, true);
      setAddedVideoId(result.videoId);
    } catch (cause) {
      setFailedVideoId(result.videoId);
      setSearchError(cause instanceof Error ? cause.message : "Không thể thêm video.");
    } finally {
      setAddingVideoId(null);
    }
  };

  const addSimilarResult = async (result: YouTubeSearchResult) => {
    setAddingVideoId(result.videoId);
    setAddedVideoId(null);
    setFailedVideoId(null);
    setSimilarError(null);
    try {
      await onAddVideo(result.videoId, true);
      setAddedVideoId(result.videoId);
    } catch (cause) {
      setFailedVideoId(result.videoId);
      setSimilarError(cause instanceof Error ? cause.message : "Không thể thêm video.");
    } finally {
      setAddingVideoId(null);
    }
  };

  const playResultNow = async (
    result: YouTubeSearchResult,
    setSourceError: (message: string | null) => void,
  ) => {
    if (!snapshot.isHost) return;
    setPlayingVideoId(result.videoId);
    setSourceError(null);
    try {
      await onPlayVideoDirectly(result.videoId);
    } catch (cause) {
      setSourceError(cause instanceof Error ? cause.message : "Không thể phát video này.");
    } finally {
      setPlayingVideoId(null);
    }
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/room/${snapshot.roomCode}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_500);
  };

  const runQueueAction = async (
    itemId: string,
    action: (itemId: string) => Promise<unknown>,
    fallbackMessage: string,
  ) => {
    setQueueBusyItemId(itemId);
    setQueueError(null);
    try {
      await action(itemId);
    } catch (cause) {
      setQueueError(cause instanceof Error ? cause.message : fallbackMessage);
    } finally {
      setQueueBusyItemId(null);
    }
  };

  const skipCurrentVideo = async () => {
    setSkipBusy(true);
    setQueueError(null);
    try {
      // A negative position distinguishes a manual skip from natural video completion.
      await onCommand("NEXT", -1);
    } catch (cause) {
      setQueueError(cause instanceof Error ? cause.message : "Không bỏ qua được video.");
    } finally {
      setSkipBusy(false);
    }
  };

  const queuedVideoIds = new Set(snapshot.queue.map((item) => item.videoId));
  const visibleSimilarResults = similarResults.filter(
    (item) => item.videoId !== snapshot.currentVideo?.videoId && !queuedVideoIds.has(item.videoId),
  );

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
                  <label htmlFor="youtube-url">Link YouTube hoặc video ID</label>
                <div className="inline-field">
                  <input
                    id="youtube-url"
                    type="text"
                    inputMode="url"
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
                  {error ?? "Hỗ trợ link video, Shorts, Live, youtu.be và link không có https://."}
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
                    const isFailed = failedVideoId === result.videoId;
                    return (
                      <VideoResultRow
                        key={result.videoId}
                        result={result}
                        state={isAdding ? "loading" : isAdded ? "success" : isFailed ? "error" : "idle"}
                        interactionDisabled={Boolean(addingVideoId || playingVideoId)}
                        canPlayNow={snapshot.isHost}
                        playing={playingVideoId === result.videoId}
                        onPlay={() => void playResultNow(result, setSearchError)}
                        onAdd={() => void addSearchResult(result)}
                      />
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </section>

        <section className="video-stage">
          <YouTubePlayer playback={snapshot.currentVideo} isHost={snapshot.isHost} onCommand={onCommand} />
        </section>

        <div className="video-meta">
          <span className="role-line">
            {snapshot.isHost ? <><Crown size={16} /> Bạn là Host</> : <><UserRound size={16} /> Host đang giữ nhịp</>}
          </span>
          {wakeLockStatus === "active" && (
            <span className="wake-lock-status"><Sun size={15} /> Màn hình luôn sáng</span>
          )}
          {snapshot.isHost && snapshot.currentVideo && (
            <div className="video-meta__actions">
              <button className="btn btn--soft btn--small" type="button" disabled={skipBusy} onClick={() => void skipCurrentVideo()}>
                {skipBusy ? <LoaderCircle className="spin" size={17} /> : <SkipForward size={17} />} Bỏ qua
              </button>
            </div>
          )}
        </div>

        <section
          className={`chat-panel chat-theme-${profile.chatTheme}${isCompactLayout ? ` ${chatOpen ? "is-mobile-open" : "is-mobile-closed"}` : ""}`}
          id="room-chat"
          aria-hidden={isCompactLayout && !chatOpen}
          inert={isCompactLayout && !chatOpen ? true : undefined}
        >
          <div className="panel-heading panel-heading--compact">
            <div><h2>Trò chuyện</h2></div>
            <button
              className="icon-action mobile-chat-close"
              type="button"
              onClick={() => setChatOpen(false)}
              aria-label="Đóng trò chuyện"
            >
              <X size={19} />
            </button>
          </div>
          <VoiceChat socket={socket} connected={connected} />
          <div className="chat-log" aria-live="polite">
            {messages.length === 0 ? (
              <div className="chat-empty"><MessageCircle size={22} /><p>nói chi bây giờ , ù húuuu</p></div>
            ) : messages.map((message) => (
              <article className={`chat-message ${message.senderSessionId === sessionId ? "is-mine" : ""}`} key={message.id}>
                <span className="chat-avatar" aria-hidden="true">
                  {message.senderAvatarUrl || (message.senderSessionId === sessionId ? profile.avatarUrl : null)
                    ? <img src={message.senderAvatarUrl ?? profile.avatarUrl ?? ""} alt="" width="32" height="32" />
                    : message.senderName.slice(0, 1).toUpperCase()}
                </span>
                <button
                  className="chat-message__content"
                  type="button"
                  onClick={() => {
                    setReplyingTo(message);
                    chatInputRef.current?.focus();
                  }}
                  aria-pressed={replyingTo?.id === message.id}
                  aria-label={`Trả lời tin nhắn của ${message.senderName}: ${message.text}`}
                >
                  <span className="chat-message__meta">
                    <strong>{message.senderName}</strong>
                    <time dateTime={new Date(message.sentAt).toISOString()}>{new Date(message.sentAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</time>
                    <Reply className="chat-message__reply-icon" size={14} aria-hidden="true" />
                  </span>
                  {message.replyTo && (
                    <span className="chat-reply-quote">
                      <strong>{message.replyTo.senderName}</strong>
                      <span>{message.replyTo.text}</span>
                    </span>
                  )}
                  <span className="chat-message__text">{message.text}</span>
                </button>
              </article>
            ))}
            <div ref={chatEndRef} />
          </div>
          {profileSyncWarning && (
            <p className="profile-sync-warning" role="status">{profileSyncWarning}</p>
          )}
          <form className="chat-form" onSubmit={sendChat}>
            <label className="visually-hidden" htmlFor="chat-message">Tin nhắn</label>
            {replyingTo && (
              <div className="chat-reply-composer">
                <div>
                  <strong>Đang trả lời {replyingTo.senderName}</strong>
                  <p>{replyingTo.text}</p>
                </div>
                <button
                  className="icon-action icon-action--quiet"
                  type="button"
                  onClick={() => setReplyingTo(null)}
                  aria-label="Hủy trả lời tin nhắn"
                >
                  <X size={17} />
                </button>
              </div>
            )}
            <button
              className="profile-avatar-button"
              type="button"
              onClick={() => setProfileOpen(true)}
              aria-label="Đổi ảnh đại diện, tên và màu trò chuyện"
              title="Chỉnh hồ sơ"
            >
              <span className="profile-avatar" aria-hidden="true">
                {profile.avatarUrl
                  ? <img src={profile.avatarUrl} alt="" width="42" height="42" />
                  : profile.name.slice(0, 1).toUpperCase() || "?"}
              </span>
              <Settings2 className="profile-avatar-button__badge" size={13} aria-hidden="true" />
            </button>
            <input
              ref={chatInputRef}
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

        {profileOpen && (
          <ProfileDialog
            profile={profile}
            onSave={saveProfile}
            onClose={() => setProfileOpen(false)}
          />
        )}

        <button
          className="mobile-chat-toggle"
          type="button"
          onClick={() => setChatOpen(true)}
          aria-controls="room-chat"
          aria-expanded={chatOpen}
          aria-label={unreadMessageCount > 0 ? `Mở trò chuyện, ${unreadMessageCount} tin nhắn mới` : "Mở trò chuyện"}
        >
          <MessageCircle size={22} />
          <span>Trò chuyện</span>
          {unreadMessageCount > 0 && (
            <strong aria-hidden="true">{Math.min(unreadMessageCount, 99)}</strong>
          )}
        </button>

        <section className="similar-panel" aria-labelledby="similar-title" aria-busy={similarBusy}>
          <div className="panel-heading panel-heading--compact">
            <div>
              <h2 id="similar-title">Hợp gu phòng</h2>
              <p><ListVideo size={15} /> Nhạc tương tự, cùng tác giả và một chút đổi gió</p>
            </div>
            <span className="count-badge">{visibleSimilarResults.length}</span>
          </div>
          {!snapshot.currentVideo && (
            <p className="similar-status">Phát một video để bắt đầu tạo gu nhạc cho phòng.</p>
          )}
          {snapshot.currentVideo && similarBusy && (
            <p className="similar-status" role="status">
              <LoaderCircle className="spin" size={18} /> Đang tìm video phù hợp…
            </p>
          )}
          {snapshot.currentVideo && similarError && (
            <p className="field-helper is-error" role="alert">{similarError}</p>
          )}
          {snapshot.currentVideo && !similarBusy && !similarError && visibleSimilarResults.length === 0 && (
            <p className="similar-status">Các gợi ý đã nằm trong hàng chờ.</p>
          )}
          <ul className="search-results similar-results">
            {visibleSimilarResults.map((result) => {
              const isAdding = addingVideoId === result.videoId;
              const isAdded = addedVideoId === result.videoId;
              const isFailed = failedVideoId === result.videoId;
              return (
                <VideoResultRow
                  key={result.videoId}
                  result={result}
                  state={isAdding ? "loading" : isAdded ? "success" : isFailed ? "error" : "idle"}
                  interactionDisabled={Boolean(addingVideoId || playingVideoId)}
                  canPlayNow={snapshot.isHost}
                  playing={playingVideoId === result.videoId}
                  onPlay={() => void playResultNow(result, setSimilarError)}
                  onAdd={() => void addSimilarResult(result)}
                />
              );
            })}
          </ul>
        </section>

        <aside className="queue-panel">
          <div className="panel-heading">
            <div><h2>Hàng chờ</h2><p>{snapshot.queue.length}/50 video</p></div>
            <span className="count-badge">{snapshot.queue.length}</span>
          </div>
          {queueError && <p className="field-helper is-error queue-error" role="alert">{queueError}</p>}
          <ol className="queue-list">
            {snapshot.queue.length === 0 ? (
              <li className="queue-empty">Chưa có video tiếp theo.</li>
            ) : snapshot.queue.map((item, index) => {
              const canRemove = snapshot.isHost || item.addedBySessionId === sessionId;
              return (
                <li className="queue-item" key={item.itemId}>
                  <span className="queue-index">{String(index + 1).padStart(2, "0")}</span>
                  <button
                    className="queue-video"
                    type="button"
                    disabled={!snapshot.isHost || queueBusyItemId !== null}
                    onClick={() => void runQueueAction(item.itemId, onPlayVideo, "Không phát được video.")}
                    aria-label={snapshot.isHost ? `Phát ${item.title}` : undefined}
                    title={snapshot.isHost ? "Phát video này ngay" : undefined}
                  >
                    <img
                      className="queue-thumbnail"
                      src={item.thumbnailUrl}
                      alt=""
                      width="120"
                      height="68"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                    <span className="queue-copy">
                      <strong>{item.title}</strong>
                      <span>{item.channelTitle}</span>
                      <small>Thêm bởi {item.addedByName}</small>
                    </span>
                  </button>
                  {canRemove && (
                    <button
                      className="icon-action queue-remove"
                      type="button"
                      disabled={queueBusyItemId !== null}
                      onClick={() => void runQueueAction(item.itemId, onRemoveVideo, "Không xóa được video.")}
                      aria-label={`Xóa ${item.title} khỏi hàng chờ`}
                      title="Xóa khỏi hàng chờ"
                    >
                      <Trash2 size={15} />
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
                <span className="avatar" aria-hidden="true">
                  {member.avatarUrl || (member.sessionId === sessionId ? profile.avatarUrl : null)
                    ? <img src={member.avatarUrl ?? profile.avatarUrl ?? ""} alt="" width="40" height="40" />
                    : member.name.slice(0, 1).toUpperCase()}
                </span>
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
