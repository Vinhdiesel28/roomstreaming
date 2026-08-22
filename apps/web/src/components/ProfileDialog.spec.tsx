import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProfileDialog } from "./ProfileDialog";

describe("ProfileDialog", () => {
  it("offers avatar upload, name editing and four chat themes", () => {
    const html = renderToStaticMarkup(
      <ProfileDialog
        profile={{ name: "Vinh", avatarUrl: null, chatTheme: "paper" }}
        onSave={vi.fn(async () => undefined)}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toContain('id="profile-name"');
    expect(html.match(/name="chat-theme"/g)).toHaveLength(4);
    expect(html).toContain("Màu bong bóng chat của bạn");
    expect(html).toContain("Lưu hồ sơ");
  });
});
