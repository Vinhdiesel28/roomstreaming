import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { InviteDialog } from "./InviteDialog";

describe("InviteDialog", () => {
  it("contains only the name field for joining", () => {
    const html = renderToStaticMarkup(
      <InviteDialog
        name=""
        connected
        connecting={false}
        busy={false}
        error={null}
        onNameChange={vi.fn()}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(html).toContain("<dialog");
    expect(html).toContain("id=\"invite-name\"");
    expect(html).toContain("Vào phòng");
    expect(html).not.toContain("Mã phòng");
  });
});
