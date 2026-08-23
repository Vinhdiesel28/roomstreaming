import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ServerWakeScreen } from "./ServerWakeScreen";

describe("ServerWakeScreen", () => {
  it("explains the Render cold start instead of leaving the page blank", () => {
    const html = renderToStaticMarkup(<ServerWakeScreen rejoining={false} roomCode="" />);
    expect(html).toContain("Máy chủ đang khởi động, vui lòng chờ…");
    expect(html).toContain("khoảng một phút");
    expect(html).toContain('aria-busy="true"');
  });

  it("shows the room that will be rejoined", () => {
    const html = renderToStaticMarkup(<ServerWakeScreen rejoining roomCode="ABCD2345" />);
    expect(html).toContain("tự vào lại phòng ABCD2345");
  });
});
