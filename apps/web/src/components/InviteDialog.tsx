import { ArrowRight, LoaderCircle, X } from "lucide-react";
import { FormEventHandler, useEffect, useRef } from "react";

interface Props {
  name: string;
  connected: boolean;
  connecting: boolean;
  busy: boolean;
  error: string | null;
  onNameChange: (name: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onClose: () => void;
}

export function InviteDialog({
  name,
  connected,
  connecting,
  busy,
  error,
  onNameChange,
  onSubmit,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    inputRef.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      className="invite-dialog"
      ref={dialogRef}
      aria-labelledby="invite-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        className="icon-action icon-action--quiet invite-dialog__close"
        type="button"
        onClick={onClose}
        aria-label="Đóng"
      >
        <X size={18} />
      </button>

      <form className="invite-dialog__form" onSubmit={onSubmit}>
        <h2 id="invite-dialog-title">Nhập tên để vào phòng</h2>
        <label htmlFor="invite-name">Tên hiển thị</label>
        <input
          ref={inputRef}
          id="invite-name"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="Ví dụ: Minh"
          minLength={2}
          maxLength={32}
          required
          autoComplete="name"
          aria-invalid={Boolean(error)}
          aria-describedby="invite-error"
        />
        <p className="invite-dialog__error" id="invite-error" role={error ? "alert" : undefined}>
          {error ?? ""}
        </p>
        <button
          className="btn btn--ink"
          type="submit"
          disabled={!connected || busy || name.trim().length < 2}
          data-state={busy ? "loading" : error ? "error" : undefined}
        >
          {busy ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}
          <span>{busy ? "Đang vào…" : connected ? "Vào phòng" : connecting ? "Đang kết nối…" : "Chưa kết nối"}</span>
        </button>
      </form>
    </dialog>
  );
}
