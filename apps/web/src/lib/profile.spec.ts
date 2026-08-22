// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { loadBrowserProfile, saveBrowserProfile, saveDisplayName } from "./profile";

describe("browser profile", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "watchroom-name=; Max-Age=0; Path=/";
    document.cookie = "watchroom-chat-theme=; Max-Age=0; Path=/";
  });

  it("persists the name, avatar and chat theme between visits", () => {
    const avatarUrl = "data:image/png;base64,AAAA";

    saveBrowserProfile({ name: "  Vinh   Nguyễn  ", avatarUrl, chatTheme: "mint" });

    expect(loadBrowserProfile()).toEqual({
      name: "Vinh Nguyễn",
      avatarUrl,
      chatTheme: "mint",
    });
    expect(localStorage.getItem("watchroom.display-name")).toBe("Vinh Nguyễn");
    expect(document.cookie).toContain("watchroom-name=Vinh%20Nguy%E1%BB%85n");
    expect(document.cookie).toContain("watchroom-chat-theme=mint");
  });

  it("keeps the saved avatar and theme when only the entry name changes", () => {
    const avatarUrl = "data:image/webp;base64,AAAA";
    saveBrowserProfile({ name: "Vinh", avatarUrl, chatTheme: "sky" });

    saveDisplayName("Tên mới");

    expect(loadBrowserProfile()).toEqual({ name: "Tên mới", avatarUrl, chatTheme: "sky" });
  });

  it("drops malformed stored avatars and themes", () => {
    localStorage.setItem("watchroom.profile", JSON.stringify({
      name: "Vinh",
      avatarUrl: "javascript:alert(1)",
      chatTheme: "neon",
    }));

    expect(loadBrowserProfile()).toEqual({ name: "Vinh", avatarUrl: null, chatTheme: "paper" });
  });
});
