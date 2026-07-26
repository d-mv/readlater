import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import * as offlineDb from "./offlineDb";
import type { OfflineBookmarkMeta } from "./offlineDb";

function makeMeta(overrides: Partial<OfflineBookmarkMeta> = {}): OfflineBookmarkMeta {
  return {
    id: "1",
    url: "https://arc90.com/x",
    type: "article",
    status: "ready",
    title: "Title",
    author: null,
    excerpt: null,
    thumbnail_url: null,
    word_count: 100,
    reading_time: 5,
    tags: [],
    is_public: false,
    archived: false,
    read_at: null,
    error_message: null,
    created_at: "2026-01-01T00:00:00Z",
    processed_at: "2026-01-01T00:01:00Z",
    ...overrides,
  };
}

describe("offlineDb", () => {
  beforeEach(async () => {
    await offlineDb._resetForTests();
  });

  afterEach(async () => {
    await offlineDb._resetForTests();
  });

  test("putArticle then getArticle round-trips the record", async () => {
    const blob = new Blob(["image bytes"], { type: "image/png" });
    await offlineDb.putArticle({
      id: "1",
      content_md: "# Hello",
      images: [{ url: "https://example.com/a.png", blob }],
      cachedAt: "2026-01-01T00:00:00Z",
    });

    const article = await offlineDb.getArticle("1");
    expect(article?.content_md).toBe("# Hello");
    expect(article?.images).toHaveLength(1);
  });

  test("getArticle returns undefined for an uncached id", async () => {
    expect(await offlineDb.getArticle("missing")).toBeUndefined();
  });

  test("deleteArticle removes a cached article", async () => {
    await offlineDb.putArticle({ id: "1", content_md: "x", images: [], cachedAt: "2026-01-01T00:00:00Z" });
    await offlineDb.deleteArticle("1");
    expect(await offlineDb.getArticle("1")).toBeUndefined();
  });

  test("listCachedArticleIds returns the ids of every cached article", async () => {
    await offlineDb.putArticle({ id: "1", content_md: "x", images: [], cachedAt: "2026-01-01T00:00:00Z" });
    await offlineDb.putArticle({ id: "2", content_md: "y", images: [], cachedAt: "2026-01-01T00:00:00Z" });
    expect(await offlineDb.listCachedArticleIds()).toEqual(expect.arrayContaining(["1", "2"]));
  });

  test("replaceBookmarksList replaces the entire offline list on each call", async () => {
    await offlineDb.replaceBookmarksList([makeMeta({ id: "1" }), makeMeta({ id: "2" })]);
    await offlineDb.replaceBookmarksList([makeMeta({ id: "2" }), makeMeta({ id: "3" })]);

    const list = await offlineDb.getBookmarksList();
    expect(list.map((b) => b.id).sort()).toEqual(["2", "3"]);
  });

  test("deleteBookmarkMeta removes a single entry from the offline list", async () => {
    await offlineDb.replaceBookmarksList([makeMeta({ id: "1" }), makeMeta({ id: "2" })]);
    await offlineDb.deleteBookmarkMeta("1");

    const list = await offlineDb.getBookmarksList();
    expect(list.map((b) => b.id)).toEqual(["2"]);
  });

  test("hydrateArticleContent replaces each cached image URL with an object URL", () => {
    const blobA = new Blob(["a"]);
    const blobB = new Blob(["b"]);
    const article = {
      id: "1",
      content_md: "![a](https://cdn/a.png) and ![b](https://cdn/b.png)",
      images: [
        { url: "https://cdn/a.png", blob: blobA },
        { url: "https://cdn/b.png", blob: blobB },
      ],
      cachedAt: "2026-01-01T00:00:00Z",
    };
    const createObjectUrl = (blob: Blob) => (blob === blobA ? "blob:a" : "blob:b");

    expect(offlineDb.hydrateArticleContent(article, createObjectUrl)).toBe("![a](blob:a) and ![b](blob:b)");
  });
});
