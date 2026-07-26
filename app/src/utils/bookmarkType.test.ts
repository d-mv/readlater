import { describe, expect, test } from "vitest";
import { detectBookmarkType } from "./bookmarkType";

describe("detectBookmarkType", () => {
  test("detects youtube.com URLs", () => {
    expect(detectBookmarkType("https://www.youtube.com/watch?v=abc")).toBe("youtube");
  });

  test("detects youtu.be short links", () => {
    expect(detectBookmarkType("https://youtu.be/abc")).toBe("youtube");
  });

  test("treats everything else as an article", () => {
    expect(detectBookmarkType("https://arc90.com/some-post")).toBe("article");
  });

  test("throws on an unparseable URL", () => {
    expect(() => detectBookmarkType("not a url")).toThrow();
  });
});
