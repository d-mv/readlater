import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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

describe("toPlain", () => {
  test("unwraps nested Vue proxies so structured clone accepts the row", async () => {
    const { isProxy, reactive } = await import("vue");
    const blob = new Blob(["x"]);
    const row = reactive({ id: "1", tags: [{ id: "t", name: "A" }], image: { blob } });

    const plain = offlineDb.toPlain(row);

    expect(() => structuredClone(row)).toThrow();
    expect(() => structuredClone(plain)).not.toThrow();
    expect(isProxy(plain) || isProxy(plain.tags) || isProxy(plain.tags[0])).toBe(false);
    expect(plain.tags).toEqual([{ id: "t", name: "A" }]);
    // Non-plain values (Blob, Date) are kept as the same object, not copied.
    expect(plain.image.blob).toBe(blob);
  });
});

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
        { id: "1", cachedAt: "2026-01-01T00:00:00Z", missingImages: 1 },
        { id: "2", cachedAt: "2026-01-01T00:00:00Z", missingImages: 0 },
      ]),
    );
  });

  describe("reading without loading article records", () => {
    // Every read of an `articles` record (which carries the image blobs),
    // by store or by index; key reads and key cursors aren't recorded.
    let articleReads: string[];

    beforeEach(() => {
      articleReads = [];
      for (const proto of [IDBObjectStore.prototype, IDBIndex.prototype]) {
        for (const method of ["get", "getAll", "openCursor"] as const) {
          const original = proto[method] as (...args: unknown[]) => unknown;
          vi.spyOn(proto, method).mockImplementation(function (
            this: IDBObjectStore | IDBIndex,
            ...args: unknown[]
          ) {
            const store = "objectStore" in this ? this.objectStore : this;
            if (store.name === "articles") articleReads.push(method);
            return original.apply(this, args);
          } as never);
        }
      }
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    test("(control) reading an article record is recorded", async () => {
      await offlineDb.getArticle("1");
      expect(articleReads).toEqual(["get"]);
    });

    test("listCachedArticles reads no article record", async () => {
      await offlineDb.putArticle({
        id: "1",
        content_md: "x",
        images: [{ url: "https://cdn/a.png", blob: new Blob(["a"]) }],
        missingImages: ["https://cdn/b.png", "https://cdn/c.png"],
        cachedAt: "2026-02-01T00:00:00Z",
      });

      expect(await offlineDb.listCachedArticles()).toEqual([
        { id: "1", cachedAt: "2026-02-01T00:00:00Z", missingImages: 2 },
      ]);
      expect(articleReads).toEqual([]);
    });

    test("replaceBookmarksList keeps a downloaded article's listed metadata without reading the article", async () => {
      await offlineDb.putArticle({
        id: "cached-1",
        content_md: "downloaded",
        images: [{ url: "https://cdn/a.png", blob: new Blob(["a"]) }],
        cachedAt: "2026-01-01T00:00:00Z",
        bookmark: makeMeta({ id: "cached-1", title: "Old copy on the article" }),
      });
      await offlineDb.putBookmarkMeta(makeMeta({ id: "cached-1", title: "Listed" }));

      await offlineDb.replaceBookmarksList([makeMeta({ id: "recent-1" })]);

      const list = await offlineDb.getBookmarksList();
      expect(list.find((b) => b.id === "cached-1")?.title).toBe("Listed");
      expect(list.map((b) => b.id).sort()).toEqual(["cached-1", "recent-1"]);
      expect(articleReads).toEqual([]);
    });
  });

  test("upgrading a version-2 database indexes its existing articles", async () => {
    await offlineDb._resetForTests();
    const v2 = await openDB("read-later-offline", 2, {
      upgrade(db) {
        db.createObjectStore("articles", { keyPath: "id" });
        db.createObjectStore("bookmarksList", { keyPath: "id" });
        db.createObjectStore("syncState");
      },
    });
    await v2.put("articles", {
      id: "a",
      content_md: "x",
      images: [],
      missingImages: ["https://cdn/x.png"],
      cachedAt: "2026-03-01T00:00:00Z",
    });
    v2.close();

    expect(await offlineDb.listCachedArticles()).toEqual([
      { id: "a", cachedAt: "2026-03-01T00:00:00Z", missingImages: 1 },
    ]);
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
      cursor: { created_at: "2026-09-01T00:00:00Z", id: "b" },
      hasMore: true,
    };

    test("a cursor stored as a bare created_at reads back covering that whole instant", async () => {
      await offlineDb.replaceBookmarksList([makeMeta({ id: "1" })], state);
      const db = await openDB("read-later-offline");
      await db.put("syncState", { ...state, cursor: "2026-09-01T00:00:00Z" }, "list");
      db.close();

      expect(await offlineDb.getSyncState()).toEqual({
        ...state,
        cursor: { created_at: "2026-09-01T00:00:00Z", id: "ffffffff-ffff-ffff-ffff-ffffffffffff" },
      });
    });

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

  test("dehydrateContent turns object URLs back into the images' original URLs", () => {
    const blobA = new Blob(["a"]);
    const article = {
      id: "1",
      content_md: "![a](https://cdn/a.png) twice ![a](https://cdn/a.png)",
      images: [{ url: "https://cdn/a.png", blob: blobA }],
      cachedAt: "2026-01-01T00:00:00Z",
    };
    const hydrated = offlineDb.hydrateArticleContent(article, () => "blob:https://app/a-1");
    const edited = `${hydrated}\n\nNew paragraph, and ![x](https://other/x.png)`;

    expect(offlineDb.dehydrateContent(edited)).toBe(
      "![a](https://cdn/a.png) twice ![a](https://cdn/a.png)\n\nNew paragraph, and ![x](https://other/x.png)",
    );
  });

  test("dehydrateContent leaves content without object URLs alone", () => {
    expect(offlineDb.dehydrateContent("plain ![x](https://cdn/x.png)")).toBe(
      "plain ![x](https://cdn/x.png)",
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

  test("hydrateArticleContent mints object URLs with URL.createObjectURL by default", () => {
    const createObjectURL = vi.fn(() => "blob:default");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL }));
    const blob = new Blob(["x"]);

    const content = offlineDb.hydrateArticleContent({
      id: "default-url",
      content_md: "![x](https://cdn/x.png)",
      images: [{ url: "https://cdn/x.png", blob }],
    });

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(content).toBe("![x](blob:default)");
    vi.unstubAllGlobals();
  });

  describe("_resetForTests", () => {
    test("rejects when the database can't be deleted", async () => {
      const req = {} as IDBOpenDBRequest;
      vi.spyOn(indexedDB, "deleteDatabase").mockImplementation(() => {
        queueMicrotask(() => {
          Object.defineProperty(req, "error", { value: new Error("delete failed") });
          req.onerror!(new Event("error"));
        });
        return req;
      });

      await expect(offlineDb._resetForTests()).rejects.toThrow("delete failed");
      vi.restoreAllMocks();
    });

    test("resolves when the delete is blocked by another open connection", async () => {
      const req = {} as IDBOpenDBRequest;
      vi.spyOn(indexedDB, "deleteDatabase").mockImplementation(() => {
        queueMicrotask(() => req.onblocked!(new Event("blocked") as IDBVersionChangeEvent));
        return req;
      });

      await expect(offlineDb._resetForTests()).resolves.toBeUndefined();
      vi.restoreAllMocks();
    });
  });
});
