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

  it("keeps the homepage behind a name-only invitation dialog", () => {
    const html = renderToStaticMarkup(<HomeScreen {...baseProps} initialCode="ABCD2345" />);
    expect(html).toContain("<dialog");
    expect(html).toContain("id=\"invite-name\"");
    expect(html).toContain("Vào phòng");
    expect(html).toContain("Tạo phòng mới");
  });

  it("keeps create and manual join forms on the homepage", () => {
    const html = renderToStaticMarkup(<HomeScreen {...baseProps} initialCode="" />);
    expect(html).toContain("Tạo phòng mới");
    expect(html).toContain("id=\"join-code\"");
  });
});
