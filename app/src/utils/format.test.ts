import { describe, expect, test } from "vitest";
import { domainFromUrl, listRowMeta, readerByline, shortDate } from "./format";

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

  test("returns PDF for url-less PDF bookmarks", () => {
    expect(domainFromUrl(null, "pdf")).toBe("PDF");
  });

  test("defaults to Note for other url-less bookmarks", () => {
    expect(domainFromUrl(null, "note")).toBe("Note");
    expect(domainFromUrl(null)).toBe("Note");
  });
});

describe("listRowMeta", () => {
  test("shows domain and reading time for an unread item", () => {
    expect(listRowMeta({ url: "https://arc90.com/x", reading_time: 6, read_at: null })).toBe(
      "arc90.com · 6 min",
    );
  });

  test("shows PDF and reading time for a PDF bookmark", () => {
    expect(listRowMeta({ url: null, type: "pdf", reading_time: 12, read_at: null })).toBe(
      "PDF · 12 min",
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

describe("shortDate", () => {
  test("formats an ISO timestamp as a short date: year, day, and no time of day", () => {
    const text = shortDate("2026-11-03T10:00:00Z");
    expect(text).toMatch(/2026/);
    expect(text).toMatch(/\b3\b/);
    expect(text).not.toMatch(/10:00|:/);
  });
});
