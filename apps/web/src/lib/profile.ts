export const CHAT_THEMES = ["paper", "sky", "mint", "coral"] as const;

export type ChatTheme = (typeof CHAT_THEMES)[number];

export interface BrowserProfile {
  name: string;
  avatarUrl: string | null;
  chatTheme: ChatTheme;
}

const PROFILE_KEY = "watchroom.profile";
const LEGACY_NAME_KEY = "watchroom.display-name";
const COOKIE_NAME = "watchroom-name";
const COOKIE_THEME = "watchroom-chat-theme";
const MAX_AVATAR_LENGTH = 60_000;

const DEFAULT_PROFILE: BrowserProfile = {
  name: "",
  avatarUrl: null,
  chatTheme: "paper",
};

function readCookie(key: string) {
  if (typeof document === "undefined") return "";
  const prefix = `${key}=`;
  const entry = document.cookie.split("; ").find((item) => item.startsWith(prefix));
  if (!entry) return "";
  try {
    return decodeURIComponent(entry.slice(prefix.length));
  } catch {
    return "";
  }
}

function isChatTheme(value: unknown): value is ChatTheme {
  return typeof value === "string" && CHAT_THEMES.includes(value as ChatTheme);
}

function isAvatarUrl(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= MAX_AVATAR_LENGTH
    && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
}

export function loadBrowserProfile(): BrowserProfile {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  let stored: Partial<BrowserProfile> = {};
  try {
    stored = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "{}") as Partial<BrowserProfile>;
  } catch {
    stored = {};
  }
  const legacyName = localStorage.getItem(LEGACY_NAME_KEY) ?? readCookie(COOKIE_NAME);
  const cookieTheme = readCookie(COOKIE_THEME);
  return {
    name: typeof stored.name === "string" ? stored.name : legacyName,
    avatarUrl: isAvatarUrl(stored.avatarUrl) ? stored.avatarUrl : null,
    chatTheme: isChatTheme(stored.chatTheme)
      ? stored.chatTheme
      : isChatTheme(cookieTheme) ? cookieTheme : "paper",
  };
}

export function saveBrowserProfile(profile: BrowserProfile) {
  const normalized: BrowserProfile = {
    name: profile.name.trim().replace(/\s+/g, " ").slice(0, 32),
    avatarUrl: isAvatarUrl(profile.avatarUrl) ? profile.avatarUrl : null,
    chatTheme: isChatTheme(profile.chatTheme) ? profile.chatTheme : "paper",
  };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(normalized));
  localStorage.setItem(LEGACY_NAME_KEY, normalized.name);
  const cookieOptions = "Max-Age=31536000; Path=/; SameSite=Lax";
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(normalized.name)}; ${cookieOptions}`;
  document.cookie = `${COOKIE_THEME}=${encodeURIComponent(normalized.chatTheme)}; ${cookieOptions}`;
  return normalized;
}

export function saveDisplayName(name: string) {
  return saveBrowserProfile({ ...loadBrowserProfile(), name });
}

export async function prepareAvatar(file: File): Promise<string> {
  if (!file.type.match(/^image\/(?:jpeg|png|webp)$/)) {
    throw new Error("Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("Ảnh lớn hơn 8 MB. Hãy chọn ảnh nhỏ hơn.");
  }

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Không đọc được ảnh này."));
      element.src = sourceUrl;
    });
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Trình duyệt không thể xử lý ảnh.");
    const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - cropSize) / 2;
    const sourceY = (image.naturalHeight - cropSize) / 2;
    const surfaceColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-surface")
      .trim();
    if (surfaceColor) {
      context.fillStyle = surfaceColor;
      context.fillRect(0, 0, size, size);
    }
    context.drawImage(image, sourceX, sourceY, cropSize, cropSize, 0, 0, size, size);
    const avatarUrl = canvas.toDataURL("image/jpeg", 0.8);
    if (!isAvatarUrl(avatarUrl)) throw new Error("Ảnh sau khi nén vẫn quá lớn.");
    return avatarUrl;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
