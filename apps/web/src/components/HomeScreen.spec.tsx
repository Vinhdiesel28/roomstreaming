// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeScreen } from "./HomeScreen";

const baseProps = {
  connected: true,
  connecting: false,
  onCreate: vi.fn(async () => undefined),
  onJoin: vi.fn(async () => undefined),
  onCancelInvite: vi.fn(),
};

describe("HomeScreen invitation flow", () => {
  beforeEach(() => localStorage.clear());

  it("shows only the name form when opened from a room link", () => {
    const html = renderToStaticMarkup(<HomeScreen {...baseProps} initialCode="ABCD2345" />);
    expect(html).toContain("Bạn được mời vào phòng");
    expect(html).toContain("ABCD2345");
    expect(html).toContain("Vào phòng");
    expect(html).not.toContain("Tạo phòng mới");
    expect(html).not.toContain("id=\"join-code\"");
  });

  it("keeps create and manual join forms on the homepage", () => {
    const html = renderToStaticMarkup(<HomeScreen {...baseProps} initialCode="" />);
    expect(html).toContain("Tạo phòng mới");
    expect(html).toContain("id=\"join-code\"");
  });
});
