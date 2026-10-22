import { describe, expect, test } from "vitest";
import { detectBookmarkType, isHttpUrl } from "./bookmarkType";

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

describe("isHttpUrl", () => {
  test.each(["https://example.com/a", "http://example.com", "HTTPS://EXAMPLE.COM"])(
    "accepts %s",
    (url) => expect(isHttpUrl(url)).toBe(true),
  );

  test.each([
    "javascript:alert(1)",
    "JavaScript://example.com/%0Aalert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "not a url",
    "",
    // URL() accepts these, but the database's ^https?:// check doesn't.
    "http:example.com",
    "https:/example.com",
    " https://example.com",
    "ht\ttp://example.com",
  ])("rejects %j", (url) => expect(isHttpUrl(url)).toBe(false));
});

describe("detectBookmarkType scheme check", () => {
  test("throws on a javascript: URL", () => {
    expect(() => detectBookmarkType("javascript:alert(1)")).toThrow();
  });
});
