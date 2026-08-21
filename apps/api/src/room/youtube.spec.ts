import { describe, expect, it } from "vitest";
import { parseYouTubeVideoId } from "./youtube";

describe("parseYouTubeVideoId", () => {
  it.each([
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=20", "dQw4w9WgXcQ"],
    ["https://youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["youtube.com/watch?v=dQw4w9WgXcQ&si=test", "dQw4w9WgXcQ"],
    ["www.youtube.com/watch/?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["//youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    [
      "https://www.youtube.com/attribution_link?u=%2Fwatch%3Fv%3DdQw4w9WgXcQ%26feature%3Dshare",
      "dQw4w9WgXcQ",
    ],
  ])("parses %s", (input, expected) => {
    expect(parseYouTubeVideoId(input)).toBe(expected);
  });

  it.each(["", "not a url", "https://example.com/watch?v=dQw4w9WgXcQ", "youtube.com.evil/watch?v=dQw4w9WgXcQ", "abc"])(
    "rejects %s",
    (input) => expect(parseYouTubeVideoId(input)).toBeNull(),
  );
});
