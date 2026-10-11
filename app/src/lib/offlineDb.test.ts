import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openDB } from "idb";
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
    translated_content_md: null,
    translated_lang: null,
    thumbnail_url: null,
    youtube_video_id: null,
    content_edited: false,
    word_count: 100,
    reading_time: 5,
    tags: [],
    is_public: false,
    archived: false,
    read_at: null,
    error_message: null,
    created_at: "2026-01-01T00:00:00Z",
    processed_at: "2026-01-01T00:01:00Z",
    updated_at: "2026-01-01T00:01:00Z",
    pdf_path: null,
    pdf_parsed: false,
    view_mode: null,
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
    await offlineDb.putArticle({
      id: "1",
      content_md: "x",
      images: [],
      cachedAt: "2026-01-01T00:00:00Z",
    });
    await offlineDb.deleteArticle("1");
    expect(await offlineDb.getArticle("1")).toBeUndefined();
  });

  test("listCachedArticles summarises every cached article with its missing-image count", async () => {
    await offlineDb.putArticle({
      id: "1",
      content_md: "x",
      images: [],
      missingImages: ["https://cdn.example.com/a.png"],
      cachedAt: "2026-01-01T00:00:00Z",
    });
    await offlineDb.putArticle({
      id: "2",
      content_md: "y",
      images: [],
      cachedAt: "2026-01-01T00:00:00Z",
    });
    // Records cached before missingImages existed count as none missing.
    expect(await offlineDb.listCachedArticles()).toEqual(
      expect.arrayContaining([
        { id: "1", missingImages: 1 },
        { id: "2", missingImages: 0 },
      ]),
    );
  });

  test("getAllArticles returns all cached articles including metadata", async () => {
    const meta = makeMeta({ id: "1", title: "Article 1" });
    await offlineDb.putArticle({
      id: "1",
      content_md: "content 1",
      images: [],
      cachedAt: "2026-01-01T00:00:00Z",
      bookmark: meta,
    });
    await offlineDb.putArticle({
      id: "2",
      content_md: "content 2",
      images: [],
      cachedAt: "2026-01-01T00:00:00Z",
    });

    const articles = await offlineDb.getAllArticles();
    expect(articles).toHaveLength(2);
    const a1 = articles.find((a) => a.id === "1");
    expect(a1?.bookmark?.title).toBe("Article 1");
  });

  test("putBookmarkMeta stores a bookmark meta item directly", async () => {
    const meta = makeMeta({ id: "direct-1", title: "Direct Title" });
    await offlineDb.putBookmarkMeta(meta);

    const list = await offlineDb.getBookmarksList();
    expect(list.find((b) => b.id === "direct-1")?.title).toBe("Direct Title");
  });

  test("replaceBookmarksList does not wipe existing list if empty items array is passed", async () => {
    await offlineDb.replaceBookmarksList([makeMeta({ id: "1" })]);
    await offlineDb.replaceBookmarksList([]);

    const list = await offlineDb.getBookmarksList();
    expect(list.map((b) => b.id)).toEqual(["1"]);
  });

  test("replaceBookmarksList preserves bookmarks for cached articles even if omitted from new list", async () => {
    const cachedMeta = makeMeta({ id: "cached-1", title: "Preserved Download" });
    await offlineDb.putArticle({
      id: "cached-1",
      content_md: "downloaded",
      images: [],
      cachedAt: "2026-01-01T00:00:00Z",
      bookmark: cachedMeta,
    });

    await offlineDb.replaceBookmarksList([makeMeta({ id: "recent-1" })]);

    const list = await offlineDb.getBookmarksList();
    const ids = list.map((b) => b.id);
    expect(ids).toContain("recent-1");
    expect(ids).toContain("cached-1");
  });

  describe("list sync state", () => {
    const state = {
      watermark: "2026-10-01T00:00:00Z",
      cursor: "2026-09-01T00:00:00Z",
      hasMore: true,
    };

    test("is absent until a list is persisted with one", async () => {
      await offlineDb.replaceBookmarksList([makeMeta({ id: "1" })]);
      expect(await offlineDb.getSyncState()).toBeUndefined();
    });

    test("replaceBookmarksList stores the sync state alongside the list", async () => {
      await offlineDb.replaceBookmarksList([makeMeta({ id: "1" })], state);

      expect(await offlineDb.getSyncState()).toEqual(state);
      expect((await offlineDb.getBookmarksList()).map((b) => b.id)).toEqual(["1"]);
    });

    test("an empty list leaves the previous sync state in place", async () => {
      await offlineDb.replaceBookmarksList([makeMeta({ id: "1" })], state);
      await offlineDb.replaceBookmarksList([], { ...state, watermark: "2026-10-09T00:00:00Z" });

      expect(await offlineDb.getSyncState()).toEqual(state);
    });

    test("upgrading a version-1 database keeps its articles and list", async () => {
      await offlineDb._resetForTests();
      const v1 = await openDB("read-later-offline", 1, {
        upgrade(db) {
          db.createObjectStore("articles", { keyPath: "id" });
          db.createObjectStore("bookmarksList", { keyPath: "id" });
        },
      });
      await v1.put("bookmarksList", makeMeta({ id: "kept" }));
      await v1.put("articles", {
        id: "a",
        content_md: "x",
        images: [],
        cachedAt: "2026-01-01T00:00:00Z",
      });
      v1.close();

      expect((await offlineDb.getBookmarksList()).map((b) => b.id)).toEqual(["kept"]);
      expect(await offlineDb.getArticle("a")).toBeDefined();
      expect(await offlineDb.getSyncState()).toBeUndefined();
    });
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

    expect(offlineDb.hydrateArticleContent(article, createObjectUrl)).toBe(
      "![a](blob:a) and ![b](blob:b)",
    );
  });

  describe("object URLs for cached images", () => {
    const article = (id = "1") => ({
      id,
      content_md: "![a](https://cdn/a.png) and ![b](https://cdn/b.png)",
      images: [
        { url: "https://cdn/a.png", blob: new Blob(["a"]) },
        { url: "https://cdn/b.png", blob: new Blob(["b"]) },
      ],
      cachedAt: "2026-01-01T00:00:00Z",
    });
    const originalRevoke = URL.revokeObjectURL;
    let revoked: string[];

    beforeEach(() => {
      revoked = [];
      URL.revokeObjectURL = (url: string) => revoked.push(url);
    });

    afterEach(() => {
      URL.revokeObjectURL = originalRevoke;
    });

    test("hydrating the same article again reuses its object URLs instead of minting new ones", () => {
      let minted = 0;
      const createObjectUrl = () => `blob:${++minted}`;
      const cached = article();

      const first = offlineDb.hydrateArticleContent(cached, createObjectUrl);
      const second = offlineDb.hydrateArticleContent(cached, createObjectUrl);

      expect(minted).toBe(2);
      expect(second).toBe(first);
    });

    test("deleting a cached article revokes its object URLs", async () => {
      await offlineDb.putArticle(article());
      let minted = 0;
      offlineDb.hydrateArticleContent(article(), () => `blob:${++minted}`);

      await offlineDb.deleteArticle("1");

      expect(revoked.sort()).toEqual(["blob:1", "blob:2"]);
    });

    test("clearAll empties every store and revokes every object URL", async () => {
      await offlineDb.putArticle(article("1"));
      await offlineDb.putArticle(article("2"));
      await offlineDb.replaceBookmarksList([makeMeta({ id: "1" })], {
        watermark: "2026-10-01T00:00:00Z",
        cursor: null,
        hasMore: false,
      });
      let minted = 0;
      offlineDb.hydrateArticleContent(article("1"), () => `blob:${++minted}`);
      offlineDb.hydrateArticleContent(article("2"), () => `blob:${++minted}`);

      await offlineDb.clearAll();

      expect(await offlineDb.getAllArticles()).toEqual([]);
      expect(await offlineDb.getBookmarksList()).toEqual([]);
      expect(await offlineDb.getSyncState()).toBeUndefined();
      expect(revoked.sort()).toEqual(["blob:1", "blob:2", "blob:3", "blob:4"]);
    });

    test("re-caching an article revokes the object URLs of its previous copy", async () => {
      let minted = 0;
      offlineDb.hydrateArticleContent(article(), () => `blob:${++minted}`);

      await offlineDb.putArticle(article());

      expect(revoked.sort()).toEqual(["blob:1", "blob:2"]);
    });
  });
});
