import { describe, expect, test } from "vitest";
import type { Bookmark } from "../lib/supabase";
import {
  buildExportPayload,
  EXPORT_VERSION,
  ImportPayloadError,
  parseExportPayload,
  partitionForImport,
  toExportBookmark,
} from "./dataTransfer";

function makeBookmark(overrides: Partial<Bookmark>): Bookmark {
  return {
    id: "1",
    url: "https://arc90.com/x",
    type: "article",
    status: "ready",
    title: "Title",
    author: null,
    excerpt: null,
    content_md: "content",
    translated_content_md: null,
    translated_lang: null,
    thumbnail_url: null,
    youtube_video_id: null,
    content_edited: false,
    word_count: 100,
    reading_time: 5,
    tags: [{ id: "t1", name: "reading", color: "#888888" }],
    is_public: false,
    archived: false,
    read_at: null,
    error_message: null,
    created_at: "2026-01-01T00:00:00Z",
    processed_at: "2026-01-01T00:01:00Z",
    pdf_path: null,
    pdf_parsed: false,
    view_mode: null,
    ...overrides,
  };
}

describe("toExportBookmark", () => {
  test("drops id and includes only the tag name/color, not the tag id", () => {
    const row = toExportBookmark(makeBookmark({ progress: 0.75 }));

    expect(row).not.toHaveProperty("id");
    expect(row.tags).toEqual([{ name: "reading", color: "#888888" }]);
    expect(row.url).toBe("https://arc90.com/x");
    expect(row.content_md).toBe("content");
    expect(row.progress).toBe(0.75);
  });
});

describe("buildExportPayload", () => {
  test("wraps rows with the current export version and a timestamp", () => {
    const payload = buildExportPayload([makeBookmark({ id: "1" }), makeBookmark({ id: "2" })]);

    expect(payload.version).toBe(EXPORT_VERSION);
    expect(payload.bookmarks).toHaveLength(2);
    expect(typeof payload.exported_at).toBe("string");
  });
});

describe("parseExportPayload", () => {
  test("parses a well-formed export", () => {
    const payload = buildExportPayload([makeBookmark({ id: "1" })]);
    const parsed = parseExportPayload(JSON.stringify(payload));

    expect(parsed.bookmarks).toHaveLength(1);
  });

  test("rejects invalid JSON", () => {
    expect(() => parseExportPayload("{not json")).toThrow(ImportPayloadError);
  });

  test("rejects a file with no bookmarks array", () => {
    expect(() => parseExportPayload(JSON.stringify({ version: EXPORT_VERSION }))).toThrow(
      ImportPayloadError,
    );
  });

  test("rejects an unsupported export version", () => {
    const payload = { version: 999, exported_at: "now", bookmarks: [] };
    expect(() => parseExportPayload(JSON.stringify(payload))).toThrow(ImportPayloadError);
  });

  describe("per-row validation", () => {
    const validRow = () =>
      toExportBookmark(makeBookmark({ id: "1" })) as unknown as Record<string, unknown>;
    const parseRows = (rows: unknown[]) =>
      parseExportPayload(
        JSON.stringify({ version: EXPORT_VERSION, exported_at: "now", bookmarks: rows }),
      );

    test("defaults a missing tags list to empty instead of failing later", () => {
      const row = validRow();
      delete row.tags;

      const { bookmarks, invalid } = parseRows([row]);

      expect(invalid).toEqual([]);
      expect(bookmarks[0].tags).toEqual([]);
    });

    test("drops keys that aren't part of the export shape (e.g. id, url_normalized)", () => {
      const row = { ...validRow(), id: "old-id", url_normalized: "x", user_id: "someone" };

      const { bookmarks } = parseRows([row]);

      expect(bookmarks[0]).not.toHaveProperty("id");
      expect(bookmarks[0]).not.toHaveProperty("url_normalized");
      expect(bookmarks[0]).not.toHaveProperty("user_id");
      expect(bookmarks[0].url).toBe("https://arc90.com/x");
    });

    test("reports malformed rows as invalid and keeps the well-formed ones", () => {
      const good = validRow();
      const badUrl = { ...validRow(), url: 42, title: "Bad url" };
      const badArchived = { ...validRow(), archived: "yes", title: "Bad archived" };
      const badType = { ...validRow(), type: "podcast", title: "Bad type" };
      const articleWithoutUrl = { ...validRow(), url: null, title: "No url" };

      const { bookmarks, invalid } = parseRows([
        good,
        badUrl,
        badArchived,
        badType,
        articleWithoutUrl,
        "not an object",
      ]);

      expect(bookmarks).toHaveLength(1);
      expect(invalid.map((row) => row.title)).toEqual([
        "Bad url",
        "Bad archived",
        "Bad type",
        "No url",
        null,
      ]);
      for (const row of invalid) expect(row.reason).toMatch(/^invalid row/);
    });

    test("fills defaults for missing optional fields", () => {
      const { bookmarks, invalid } = parseRows([
        { url: null, type: "note", status: "ready", content_md: "just a note" },
      ]);

      expect(invalid).toEqual([]);
      expect(bookmarks[0]).toMatchObject({
        title: null,
        archived: false,
        is_public: false,
        content_edited: false,
        pdf_parsed: false,
        view_mode: null,
        progress: 0,
        tags: [],
      });
    });
  });
});

describe("partitionForImport", () => {
  test("skips rows whose URL (normalized) already exists", () => {
    const rows = [
      toExportBookmark(makeBookmark({ url: "https://arc90.com/x", title: "Existing" })),
      toExportBookmark(makeBookmark({ url: "https://new.example/y", title: "New" })),
    ];
    const existing = new Set([normalizeMatch("https://arc90.com/x")]);

    const { toImport, skipped } = partitionForImport(rows, existing);

    expect(toImport.map((r) => r.title)).toEqual(["New"]);
    expect(skipped).toEqual([
      { url: "https://arc90.com/x", title: "Existing", reason: "already exists" },
    ]);
  });

  test("matches duplicates case-insensitively and ignoring trailing slashes", () => {
    const rows = [toExportBookmark(makeBookmark({ url: "HTTPS://Example.com/Path/" }))];
    const existing = new Set(["https://example.com/path"]);

    const { toImport, skipped } = partitionForImport(rows, existing);

    expect(toImport).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });

  test("never treats url-less rows (notes, PDFs) as duplicates", () => {
    const rows = [toExportBookmark(makeBookmark({ url: null, type: "note", title: "A note" }))];

    const { toImport, skipped } = partitionForImport(rows, new Set());

    expect(toImport).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });

  function normalizeMatch(url: string): string {
    return url.toLowerCase();
  }
});
