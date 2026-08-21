import { ArrowRight, Link2, Plus, Radio, ShieldCheck, Users } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { InviteDialog } from "./InviteDialog";

interface Props {
  connected: boolean;
  connecting: boolean;
  initialCode: string;
  onCreate: (name: string) => Promise<void>;
  onJoin: (code: string, name: string) => Promise<void>;
  onCancelInvite: () => void;
}

const NAME_KEY = "watchroom.display-name";

export function HomeScreen({
  connected,
  connecting,
  initialCode,
  onCreate,
  onJoin,
  onCancelInvite,
}: Props) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCode(initialCode);
  }, [initialCode]);

  const rememberName = () => localStorage.setItem(NAME_KEY, name.trim());

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("create");
    setError(null);
    try {
      rememberName();
      await onCreate(name.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tạo phòng.");
    } finally {
      setBusy(null);
    }
  };

  const submitJoin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("join");
    setError(null);
    try {
      rememberName();
      await onJoin(code.trim().toUpperCase(), name.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể vào phòng.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <main className="home">
        <section className="home-intro reveal" style={{ "--i": 0 } as React.CSSProperties}>
        <div className="live-mark" aria-hidden="true"><span /></div>
        <h1>Xem cùng nhau.<br />Không cần tài khoản.</h1>
        <p className="home-intro__lede">
          Mỗi người xem trực tiếp từ YouTube. Watchroom chỉ giữ nhịp video, hàng chờ và cuộc trò chuyện đang diễn ra.
        </p>
        <div className="truth-list" aria-label="Đặc điểm của Watchroom">
          <span><Radio size={18} /> Đồng bộ tức thời</span>
          <span><ShieldCheck size={18} /> Không lưu chat</span>
          <span><Users size={18} /> Tối đa 20 người</span>
        </div>
        </section>

      <section className="entry-workbench reveal" style={{ "--i": 1 } as React.CSSProperties}>
        <form className="entry-card entry-card--pear" onSubmit={submitCreate}>
          <div className="entry-card__head">
            <span className="entry-icon"><Plus size={22} /></span>
            <div><h2>Tạo phòng mới</h2><p>Bạn sẽ là Host.</p></div>
          </div>
          <label htmlFor="create-name">Tên hiển thị</label>
          <input
            id="create-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ví dụ: Minh"
            minLength={2}
            maxLength={32}
            required
          />
          <button className="btn btn--primary" disabled={!connected || busy !== null} type="submit">
            <span>{busy === "create" ? "Đang tạo…" : "Tạo phòng"}</span>
            <ArrowRight size={18} />
          </button>
        </form>

        <form className="entry-card entry-card--cyan" onSubmit={submitJoin}>
          <div className="entry-card__head">
            <span className="entry-icon"><Link2 size={22} /></span>
            <div><h2>Vào phòng</h2><p>Dùng mã gồm 8 ký tự.</p></div>
          </div>
          <label htmlFor="join-code">Mã phòng</label>
          <input
            id="join-code"
            className="code-input"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))}
            placeholder="ABCD2345"
            minLength={8}
            maxLength={8}
            required
          />
          <label htmlFor="join-name">Tên hiển thị</label>
          <input
            id="join-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ví dụ: Minh"
            minLength={2}
            maxLength={32}
            required
          />
          <button className="btn btn--ink" disabled={!connected || busy !== null} type="submit">
            <span>{busy === "join" ? "Đang vào…" : "Vào phòng"}</span>
            <ArrowRight size={18} />
          </button>
        </form>

        <div className="connection-copy" role="status" aria-live="polite">
          <span className={`connection-dot ${connected ? "is-online" : ""}`} />
          {connected ? "Máy chủ đã sẵn sàng" : connecting ? "Đang đánh thức máy chủ…" : "Máy chủ đang ngoại tuyến"}
        </div>
          {error && !initialCode && <p className="form-error" role="alert">{error}</p>}
        </section>
      </main>
      {initialCode && (
        <InviteDialog
          name={name}
          connected={connected}
          connecting={connecting}
          busy={busy === "join"}
          error={error}
          onNameChange={(nextName) => {
            setName(nextName);
            if (error) setError(null);
          }}
          onSubmit={submitJoin}
          onClose={onCancelInvite}
        />
      )}
    </>
  );
}
