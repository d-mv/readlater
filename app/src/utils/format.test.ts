import { describe, expect, test } from "vitest";
import { domainFromUrl, listRowMeta, readerByline } from "./format";

describe("domainFromUrl", () => {
  test("strips protocol and www", () => {
    expect(domainFromUrl("https://www.youtube.com/watch?v=abc")).toBe("youtube.com");
  });

  test("keeps non-www subdomains", () => {
    expect(domainFromUrl("https://blog.samaltman.com/post")).toBe("blog.samaltman.com");
  });

  test("returns the raw string for an unparseable URL rather than throwing", () => {
    expect(domainFromUrl("not a url")).toBe("not a url");
  });
});

describe("listRowMeta", () => {
  test("shows domain and reading time for an unread item", () => {
    expect(listRowMeta({ url: "https://arc90.com/x", reading_time: 6, read_at: null })).toBe(
      "arc90.com · 6 min",
    );
  });

  test("appends 'read' for a read item", () => {
    expect(
      listRowMeta({ url: "https://arc90.com/x", reading_time: 6, read_at: "2026-01-01T00:00:00Z" }),
    ).toBe("arc90.com · 6 min · read");
  });

  test("falls back gracefully when reading_time is not yet computed", () => {
    expect(listRowMeta({ url: "https://arc90.com/x", reading_time: null, read_at: null })).toBe(
      "arc90.com",
    );
  });
});

describe("readerByline", () => {
  test("combines author and reading time", () => {
    expect(readerByline({ author: "The Arc90 team", reading_time: 6 })).toBe(
      "By The Arc90 team · 6 min read",
    );
  });

  test("omits the byline prefix when there is no author", () => {
    expect(readerByline({ author: null, reading_time: 6 })).toBe("6 min read");
  });
});
