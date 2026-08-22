import { Camera, LoaderCircle, Trash2, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  CHAT_THEMES,
  prepareAvatar,
  type BrowserProfile,
  type ChatTheme,
} from "../lib/profile";

interface Props {
  profile: BrowserProfile;
  onSave: (profile: BrowserProfile) => Promise<void>;
  onClose: () => void;
}

const THEME_LABELS: Record<ChatTheme, string> = {
  paper: "Kem",
  sky: "Xanh trời",
  mint: "Xanh lá",
  coral: "Hồng san hô",
};

export function ProfileDialog({ profile, onSave, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(profile);
  const [processingImage, setProcessingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    nameInputRef.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...draft, name: draft.name.trim() });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lưu được hồ sơ.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog
      className="profile-dialog"
      ref={dialogRef}
      aria-labelledby="profile-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form className="profile-form" onSubmit={submit}>
        <div className="profile-form__heading">
          <div>
            <h2 id="profile-dialog-title">Hồ sơ của bạn</h2>
            <p>Được nhớ trên trình duyệt này.</p>
          </div>
          <button className="icon-action icon-action--quiet" type="button" onClick={onClose} aria-label="Đóng">
            <X size={18} />
          </button>
        </div>

        <div className="profile-avatar-editor">
          <span className="profile-avatar profile-avatar--large" aria-hidden="true">
            {draft.avatarUrl
              ? <img src={draft.avatarUrl} alt="" width="96" height="96" />
              : draft.name.trim().slice(0, 1).toUpperCase() || "?"}
          </span>
          <div className="profile-avatar-editor__actions">
            <label className={`btn btn--soft btn--small profile-file-action ${processingImage || saving ? "is-disabled" : ""}`}>
              {processingImage ? <LoaderCircle className="spin" size={17} /> : <Camera size={17} />}
              <span>{processingImage ? "Đang nén ảnh" : "Chọn ảnh"}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={processingImage || saving}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  setProcessingImage(true);
                  setError(null);
                  try {
                    const avatarUrl = await prepareAvatar(file);
                    setDraft((current) => ({ ...current, avatarUrl }));
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : "Không xử lý được ảnh.");
                  } finally {
                    setProcessingImage(false);
                  }
                }}
              />
            </label>
            {draft.avatarUrl && (
              <button
                className="btn btn--small profile-remove-avatar"
                type="button"
                disabled={processingImage || saving}
                onClick={() => setDraft((current) => ({ ...current, avatarUrl: null }))}
              >
                <Trash2 size={17} /> Xóa ảnh
              </button>
            )}
            <p>JPG, PNG hoặc WebP · tối đa 8 MB</p>
          </div>
        </div>

        <label htmlFor="profile-name">Tên hiển thị</label>
        <input
          ref={nameInputRef}
          id="profile-name"
          value={draft.name}
          onChange={(event) => {
            setDraft((current) => ({ ...current, name: event.target.value }));
            if (error) setError(null);
          }}
          minLength={2}
          maxLength={32}
          required
          autoComplete="name"
          aria-invalid={Boolean(error)}
          aria-describedby="profile-error"
        />

        <fieldset className="chat-theme-picker">
          <legend>Màu bong bóng chat của bạn</legend>
          <div>
            {CHAT_THEMES.map((theme) => (
              <label key={theme} className={`chat-theme-choice chat-theme-choice--${theme}`}>
                <input
                  type="radio"
                  name="chat-theme"
                  value={theme}
                  checked={draft.chatTheme === theme}
                  onChange={() => setDraft((current) => ({ ...current, chatTheme: theme }))}
                />
                <span aria-hidden="true" />
                <strong>{THEME_LABELS[theme]}</strong>
              </label>
            ))}
          </div>
        </fieldset>

        <p className={`profile-form__error ${error ? "is-visible" : ""}`} id="profile-error" role={error ? "alert" : undefined}>
          {error ?? "Tên, màu và avatar sẽ được dùng lại vào lần sau."}
        </p>
        <button
          className="btn btn--ink profile-save"
          type="submit"
          disabled={saving || processingImage || draft.name.trim().length < 2}
          data-state={saving ? "loading" : error ? "error" : undefined}
        >
          {saving && <LoaderCircle className="spin" size={18} />}
          <span>{saving ? "Đang lưu" : "Lưu hồ sơ"}</span>
        </button>
      </form>
    </dialog>
  );
}
