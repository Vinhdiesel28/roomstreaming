import { describe, expect, it } from "vitest";
import { parseYouTubeVideoId } from "./youtube";

describe("parseYouTubeVideoId", () => {
  it.each([
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=20", "dQw4w9WgXcQ"],
    ["https://youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("parses %s", (input, expected) => {
    expect(parseYouTubeVideoId(input)).toBe(expected);
  });

  it.each(["", "not a url", "https://example.com/watch?v=dQw4w9WgXcQ", "abc"])(
    "rejects %s",
    (input) => expect(parseYouTubeVideoId(input)).toBeNull(),
  );
});
