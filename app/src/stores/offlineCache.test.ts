import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Bookmark } from "../lib/supabase";

const {
  putArticle,
  deleteArticle,
  listCachedArticles,
  getArticle,
  putBookmarkMeta,
  getBookmarksList,
} = vi.hoisted(() => ({
  putArticle: vi.fn(),
  deleteArticle: vi.fn(),
  listCachedArticles: vi.fn(),
  getArticle: vi.fn(),
  putBookmarkMeta: vi.fn(),
  getBookmarksList: vi.fn(),
}));
vi.mock("../lib/offlineDb", () => ({
  putArticle,
  deleteArticle,
  listCachedArticles,
  getArticle,
  putBookmarkMeta,
  getBookmarksList,
  stripContentMd: (b: any) => {
    const { content_md: _content_md, ...meta } = b;
    return meta;
  },
}));

const { useOfflineCacheStore } = await import("./offlineCache");

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: "1",
    url: "https://arc90.com/x",
    type: "article",
    status: "ready",
    title: "Title",
    author: null,
    excerpt: null,
    content_md: "![img](https://cdn.example.com/a.png) body text",
    translated_content_md: null,
    translated_lang: null,
    thumbnail_url: "https://cdn.example.com/thumb.png",
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

describe("useOfflineCacheStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    listCachedArticles.mockResolvedValue([]);
    getBookmarksList.mockResolvedValue([]);
    putArticle.mockResolvedValue(undefined);
    deleteArticle.mockResolvedValue(undefined);
    getArticle.mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["x"])) }),
    );
  });

  describe("eviction on init", () => {
    const NOW = Date.parse("2026-10-11T12:00:00Z");
    const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
    const cached = (id: string, days: number) => ({
      id,
      cachedAt: daysAgo(days),
      missingImages: 0,
    });
    const read = (id: string) => makeBookmark({ id, read_at: "2026-10-01T00:00:00Z" });

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test("drops read, archived and unknown items' copies past 30 days, keeping unread ones", async () => {
      listCachedArticles.mockResolvedValue([
        cached("old-read", 40),
        cached("old-archived", 40),
        cached("old-unknown", 40),
        cached("old-unread", 400),
        cached("recent-read", 5),
      ]);
      getBookmarksList.mockResolvedValue([
        read("old-read"),
        makeBookmark({ id: "old-archived", archived: true }),
        makeBookmark({ id: "old-unread" }),
        read("recent-read"),
      ]);

      const store = useOfflineCacheStore();
      await store.init();

      expect(deleteArticle.mock.calls.map(([id]) => id).sort()).toEqual([
        "old-archived",
        "old-read",
        "old-unknown",
      ]);
      expect(store.isCached("old-unread")).toBe(true);
      expect(store.isCached("recent-read")).toBe(true);
      expect(store.isCached("old-read")).toBe(false);
    });

    test("over 200 copies, drops the oldest read ones until 200 remain", async () => {
      const articles = Array.from({ length: 205 }, (_, i) => cached(`r${i}`, i % 20));
      listCachedArticles.mockResolvedValue([...articles, cached("unread", 25)]);
      getBookmarksList.mockResolvedValue([
        ...articles.map((a) => read(a.id)),
        makeBookmark({ id: "unread" }),
      ]);

      const store = useOfflineCacheStore();
      await store.init();

      // 206 cached, 6 over: the six oldest read copies (19 days old) go.
      expect(deleteArticle).toHaveBeenCalledTimes(6);
      expect(deleteArticle.mock.calls.map(([id]) => id)).toEqual(
        expect.arrayContaining(["r19", "r39", "r59", "r79", "r99", "r119"]),
      );
      expect(store.isCached("unread")).toBe(true);
    });

    test("runs once per session, asking for persistent storage once", async () => {
      const persist = vi.fn().mockResolvedValue(true);
      vi.stubGlobal("navigator", { ...navigator, storage: { persist } });
      listCachedArticles.mockResolvedValue([cached("old-read", 40)]);
      getBookmarksList.mockResolvedValue([read("old-read")]);

      const store = useOfflineCacheStore();
      await store.init();
      await store.init();

      expect(persist).toHaveBeenCalledOnce();
      expect(deleteArticle).toHaveBeenCalledOnce();
      vi.unstubAllGlobals();
    });

    test("a failing eviction doesn't fail init", async () => {
      getBookmarksList.mockRejectedValue(new Error("IDB gone"));
      listCachedArticles.mockResolvedValue([cached("a", 40)]);

      const store = useOfflineCacheStore();
      await expect(store.init()).resolves.toBeUndefined();
      expect(store.isCached("a")).toBe(true);
    });
  });

  describe("images that could not be saved", () => {
    test("a rejected or non-OK image download is recorded on the cached article", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) =>
          url.endsWith("a.png")
            ? Promise.reject(new TypeError("CORS"))
            : Promise.resolve({ ok: false, blob: () => Promise.resolve(new Blob(["404"])) }),
        ),
      );

      const store = useOfflineCacheStore();
      await store.cacheBookmark(makeBookmark());

      expect(putArticle).toHaveBeenCalledWith(
        expect.objectContaining({
          images: [],
          missingImages: ["https://cdn.example.com/a.png", "https://cdn.example.com/thumb.png"],
        }),
      );
      expect(store.missingImageCount("1")).toBe(2);
      expect(store.missingImageCounts.get("1")).toBe(2);
    });

    test("a fully saved article reports none missing", async () => {
      const store = useOfflineCacheStore();
      await store.cacheBookmark(makeBookmark());

      expect(putArticle).toHaveBeenCalledWith(expect.objectContaining({ missingImages: [] }));
      expect(store.missingImageCount("1")).toBe(0);
    });

    test("init restores missing-image counts from earlier sessions", async () => {
      listCachedArticles.mockResolvedValue([
        { id: "1", cachedAt: new Date().toISOString(), missingImages: 3 },
      ]);

      const store = useOfflineCacheStore();
      await store.init();

      expect(store.missingImageCount("1")).toBe(3);
    });

    test("removing the offline copy clears its count", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("CORS")));
      const store = useOfflineCacheStore();
      await store.cacheBookmark(makeBookmark());

      await store.removeCachedBookmark("1");

      expect(store.missingImageCount("1")).toBe(0);
    });
  });

  test("init loads already-cached ids so isCached reflects prior sessions", async () => {
    listCachedArticles.mockResolvedValue([
      { id: "1", cachedAt: new Date().toISOString(), missingImages: 0 },
      { id: "2", cachedAt: new Date().toISOString(), missingImages: 0 },
    ]);

    const store = useOfflineCacheStore();
    await store.init();

    expect(store.isCached("1")).toBe(true);
    expect(store.isCached("3")).toBe(false);
  });

  test("cacheBookmark fetches every image referenced in content and thumbnail, then persists the article", async () => {
    const store = useOfflineCacheStore();
    await store.cacheBookmark(makeBookmark());

    expect(fetch).toHaveBeenCalledWith("https://cdn.example.com/a.png", {
      signal: expect.any(AbortSignal),
    });
    expect(fetch).toHaveBeenCalledWith("https://cdn.example.com/thumb.png", {
      signal: expect.any(AbortSignal),
    });
    expect(putArticle).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "1",
        content_md: expect.stringContaining("body text"),
        bookmark: expect.objectContaining({ id: "1", title: "Title" }),
      }),
    );
    expect(putBookmarkMeta).toHaveBeenCalledWith(
      expect.objectContaining({ id: "1", title: "Title" }),
    );
    expect(store.isCached("1")).toBe(true);
  });

  test("cacheBookmark still caches the text and metadata when an image fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const store = useOfflineCacheStore();
    await store.cacheBookmark(makeBookmark());

    expect(putArticle).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "1",
        images: [],
        bookmark: expect.objectContaining({ id: "1", title: "Title" }),
      }),
    );
    expect(putBookmarkMeta).toHaveBeenCalledWith(
      expect.objectContaining({ id: "1", title: "Title" }),
    );
    expect(store.isCached("1")).toBe(true);
  });

  test("cacheBookmark is a no-op when the article is already cached in this session", async () => {
    const store = useOfflineCacheStore();
    await store.cacheBookmark(makeBookmark());
    vi.mocked(fetch).mockClear();
    putArticle.mockClear();
    putBookmarkMeta.mockClear();

    await store.cacheBookmark(makeBookmark());

    expect(fetch).not.toHaveBeenCalled();
    expect(putArticle).not.toHaveBeenCalled();
    expect(putBookmarkMeta).not.toHaveBeenCalled();
  });

  test("cacheBookmark updates missing bookmark metadata when the article was cached in a prior session without metadata", async () => {
    getArticle.mockResolvedValue({ id: "1", content_md: "x", images: [], cachedAt: "t" });

    const store = useOfflineCacheStore();
    await store.cacheBookmark(makeBookmark());

    expect(fetch).not.toHaveBeenCalled();
    expect(putArticle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "1", bookmark: expect.objectContaining({ title: "Title" }) }),
    );
    expect(putBookmarkMeta).toHaveBeenCalledWith(
      expect.objectContaining({ id: "1", title: "Title" }),
    );
    expect(store.isCached("1")).toBe(true);
  });

  test("cacheBookmark does nothing for a bookmark with no content yet", async () => {
    const store = useOfflineCacheStore();
    await store.cacheBookmark(makeBookmark({ content_md: null }));

    expect(putArticle).not.toHaveBeenCalled();
    expect(store.isCached("1")).toBe(false);
  });

  test("removeCachedBookmark evicts the article and clears the cached flag", async () => {
    const store = useOfflineCacheStore();
    await store.cacheBookmark(makeBookmark());
    expect(store.isCached("1")).toBe(true);

    await store.removeCachedBookmark("1");

    expect(deleteArticle).toHaveBeenCalledWith("1");
    expect(store.isCached("1")).toBe(false);
  });

  describe("saves in flight", () => {
    /** fetch() that holds every image download until release() is called. */
    function heldFetch() {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const fetchMock = vi.fn(async () => {
        await gate;
        return { blob: () => Promise.resolve(new Blob(["x"])) };
      });
      vi.stubGlobal("fetch", fetchMock);
      return { fetchMock, release };
    }

    test("removing an article while it is being saved leaves no offline copy", async () => {
      const { release } = heldFetch();
      const store = useOfflineCacheStore();

      const saving = store.cacheBookmark(makeBookmark());
      await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
      await store.removeCachedBookmark("1");
      release();
      await saving;

      expect(putArticle).not.toHaveBeenCalled();
      expect(store.isCached("1")).toBe(false);
    });

    test("a remove that lands while the article is being written deletes it afterwards", async () => {
      let finishPut!: () => void;
      putArticle.mockReturnValue(new Promise<void>((r) => (finishPut = r)));
      const store = useOfflineCacheStore();

      const saving = store.cacheBookmark(makeBookmark());
      await vi.waitFor(() => expect(putArticle).toHaveBeenCalled());
      await store.removeCachedBookmark("1");
      deleteArticle.mockClear();
      finishPut();
      await saving;

      expect(deleteArticle).toHaveBeenCalledWith("1");
      expect(store.isCached("1")).toBe(false);
    });

    test("reset forgets every entry, and a save in flight never commits after it", async () => {
      listCachedArticles.mockResolvedValue([
        { id: "1", cachedAt: new Date().toISOString(), missingImages: 2 },
      ]);
      const store = useOfflineCacheStore();
      await store.init();
      expect(store.isCached("1")).toBe(true);
      const { release } = heldFetch();

      const saving = store.cacheBookmark(makeBookmark({ id: "2" }));
      await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
      store.reset();
      release();
      await saving;

      expect(store.isCached("1")).toBe(false);
      expect(store.isCached("2")).toBe(false);
      expect(putArticle).not.toHaveBeenCalled();
      expect(store.missingImageCount("1")).toBe(0);
    });

    test("a reset that lands while the article is being written writes no metadata after it", async () => {
      let finishPut!: () => void;
      putArticle.mockReturnValue(new Promise<void>((r) => (finishPut = r)));
      const store = useOfflineCacheStore();

      const saving = store.cacheBookmark(makeBookmark());
      await vi.waitFor(() => expect(putArticle).toHaveBeenCalled());
      store.reset();
      finishPut();
      await saving;

      expect(putBookmarkMeta).not.toHaveBeenCalled();
      expect(deleteArticle).toHaveBeenCalledWith("1");
    });

    test("a reset while an earlier copy is being looked up writes nothing", async () => {
      let found!: (value: unknown) => void;
      getArticle.mockReturnValue(new Promise((r) => (found = r)));
      const store = useOfflineCacheStore();

      const saving = store.cacheBookmark(makeBookmark());
      await vi.waitFor(() => expect(getArticle).toHaveBeenCalled());
      store.reset();
      found({ id: "1", content_md: "x", images: [], cachedAt: "2026-01-01T00:00:00Z" });
      await saving;

      expect(putArticle).not.toHaveBeenCalled();
      expect(putBookmarkMeta).not.toHaveBeenCalled();
      expect(store.isCached("1")).toBe(false);
    });

    describe("an earlier copy without metadata", () => {
      const earlier = { id: "1", content_md: "x", images: [], cachedAt: "2026-01-01T00:00:00Z" };

      test("a reset while the copy is being updated writes no metadata", async () => {
        getArticle.mockResolvedValue(earlier);
        let finishPut!: () => void;
        putArticle.mockReturnValue(new Promise<void>((r) => (finishPut = r)));
        const store = useOfflineCacheStore();

        const saving = store.cacheBookmark(makeBookmark());
        await vi.waitFor(() => expect(putArticle).toHaveBeenCalled());
        store.reset();
        finishPut();
        await saving;

        expect(putBookmarkMeta).not.toHaveBeenCalled();
        expect(store.isCached("1")).toBe(false);
      });

      test("a reset while its metadata is being written leaves it unsaved", async () => {
        getArticle.mockResolvedValue(earlier);
        let finishMeta!: () => void;
        putBookmarkMeta.mockReturnValue(new Promise<void>((r) => (finishMeta = r)));
        const store = useOfflineCacheStore();

        const saving = store.cacheBookmark(makeBookmark());
        await vi.waitFor(() => expect(putBookmarkMeta).toHaveBeenCalled());
        store.reset();
        finishMeta();
        await saving;

        expect(store.isCached("1")).toBe(false);
      });
    });

    test("an image download that hangs is given up on, not waited for forever", async () => {
      const signals: AbortSignal[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init?: RequestInit) => {
          signals.push(init!.signal!);
          return Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["x"])) });
        }),
      );

      await useOfflineCacheStore().cacheBookmark(makeBookmark());

      expect(signals.length).toBeGreaterThan(0);
      expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
    });

    test("a second save of the same article reuses the one in flight", async () => {
      const { fetchMock, release } = heldFetch();
      const store = useOfflineCacheStore();

      const first = store.cacheBookmark(makeBookmark());
      const second = store.cacheBookmark(makeBookmark());
      release();
      await Promise.all([first, second]);

      // Two images (inline + thumbnail), downloaded once.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(putArticle).toHaveBeenCalledTimes(1);
      expect(store.isCached("1")).toBe(true);
    });

    test("init while a save is in flight doesn't lose the article once it finishes", async () => {
      const { release } = heldFetch();
      listCachedArticles.mockResolvedValue([]);
      const store = useOfflineCacheStore();

      const saving = store.cacheBookmark(makeBookmark());
      await store.init();
      release();
      await saving;

      expect(store.isCached("1")).toBe(true);
    });

    test("a failed write clears the saving state so the article can be saved again", async () => {
      putArticle.mockRejectedValueOnce(new Error("QuotaExceededError"));
      const store = useOfflineCacheStore();

      await expect(store.cacheBookmark(makeBookmark())).rejects.toThrow("QuotaExceededError");
      expect(store.isCached("1")).toBe(false);

      await store.cacheBookmark(makeBookmark());
      expect(store.isCached("1")).toBe(true);
    });
  });

  describe("refreshCached", () => {
    test("rewrites an already-cached article with its edited body and translation", async () => {
      const store = useOfflineCacheStore();
      await store.cacheBookmark(makeBookmark({ content_md: "old body" }));
      putArticle.mockClear();

      await store.refreshCached(
        makeBookmark({ content_md: "edited body", translated_content_md: "cuerpo editado" }),
      );

      expect(putArticle).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "1",
          content_md: "edited body",
          translated_content_md: "cuerpo editado",
        }),
      );
      expect(store.isCached("1")).toBe(true);
    });

    test("does nothing for an article that isn't cached offline", async () => {
      const store = useOfflineCacheStore();

      await store.refreshCached(makeBookmark({ content_md: "edited body" }));

      expect(putArticle).not.toHaveBeenCalled();
      expect(store.isCached("1")).toBe(false);
    });
  });

  test("cacheBookmark stores the cached translation alongside the body", async () => {
    const store = useOfflineCacheStore();
    await store.cacheBookmark(makeBookmark({ translated_content_md: "traducción" }));

    expect(putArticle).toHaveBeenCalledWith(
      expect.objectContaining({ translated_content_md: "traducción" }),
    );
  });

  describe("coverage of the remaining edge cases", () => {
    function deferred<T = void>() {
      let resolve!: (value: T) => void;
      let reject!: (err: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    test("a refused persistent-storage request doesn't fail init", async () => {
      const persist = vi.fn().mockRejectedValue(new Error("denied"));
      vi.stubGlobal("navigator", { ...navigator, storage: { persist } });

      const store = useOfflineCacheStore();
      await expect(store.init()).resolves.toBeUndefined();

      expect(persist).toHaveBeenCalledOnce();
      vi.unstubAllGlobals();
    });

    test("without a thumbnail only the images in the body are downloaded", async () => {
      const store = useOfflineCacheStore();
      await store.cacheBookmark(makeBookmark({ thumbnail_url: null }));

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith("https://cdn.example.com/a.png", {
        signal: expect.any(AbortSignal),
      });
    });

    test("cachedIds lists saved articles only, not ones still being saved", async () => {
      listCachedArticles.mockResolvedValue([
        { id: "saved", cachedAt: new Date().toISOString(), missingImages: 0 },
      ]);
      const store = useOfflineCacheStore();
      await store.init();
      const write = deferred();
      putArticle.mockReturnValueOnce(write.promise);

      const saving = store.cacheBookmark(makeBookmark({ id: "pending" }));

      expect([...store.cachedIds]).toEqual(["saved"]);
      write.resolve();
      await saving;
      expect([...store.cachedIds].sort()).toEqual(["pending", "saved"]);
    });

    test("init drops an article saved earlier whose copy is no longer in IndexedDB", async () => {
      const store = useOfflineCacheStore();
      await store.cacheBookmark(makeBookmark());
      expect(store.isCached("1")).toBe(true);

      listCachedArticles.mockResolvedValue([]);
      await store.init();

      expect(store.isCached("1")).toBe(false);
    });

    test("eviction leaves an article that is being saved right now", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.parse("2026-10-11T12:00:00Z"));
      listCachedArticles.mockResolvedValue([
        { id: "1", cachedAt: "2026-08-01T00:00:00Z", missingImages: 0 },
      ]);
      const write = deferred();
      putArticle.mockReturnValueOnce(write.promise);
      const store = useOfflineCacheStore();

      const saving = store.cacheBookmark(makeBookmark({ read_at: "2026-09-01T00:00:00Z" }));
      await vi.waitFor(() => expect(putArticle).toHaveBeenCalled());
      await store.init();
      write.resolve();
      await saving;

      expect(deleteArticle).not.toHaveBeenCalled();
      expect(store.isCached("1")).toBe(true);
      vi.useRealTimers();
    });

    test("an earlier offline copy that already has its metadata is reused untouched", async () => {
      getArticle.mockResolvedValue({
        id: "1",
        content_md: "x",
        images: [],
        cachedAt: "t",
        bookmark: { id: "1" },
      });

      const store = useOfflineCacheStore();
      await store.cacheBookmark(makeBookmark());

      expect(fetch).not.toHaveBeenCalled();
      expect(putArticle).not.toHaveBeenCalled();
      expect(putBookmarkMeta).not.toHaveBeenCalled();
      expect(store.isCached("1")).toBe(true);
    });

    test("removing an article while its earlier copy is being looked up leaves it removed", async () => {
      const lookup = deferred<unknown>();
      getArticle.mockReturnValueOnce(lookup.promise);
      const store = useOfflineCacheStore();

      const saving = store.cacheBookmark(makeBookmark());
      await store.removeCachedBookmark("1");
      lookup.resolve({ id: "1", content_md: "x", images: [], cachedAt: "t", bookmark: {} });
      await saving;

      expect(store.isCached("1")).toBe(false);
    });

    test("a save superseded by a refresh while writing keeps the newer copy", async () => {
      const firstWrite = deferred();
      putArticle.mockReturnValueOnce(firstWrite.promise);
      const store = useOfflineCacheStore();

      const first = store.cacheBookmark(makeBookmark());
      await vi.waitFor(() => expect(putArticle).toHaveBeenCalledTimes(1));
      const second = store.refreshCached(makeBookmark({ content_md: "edited body" }));
      firstWrite.resolve();
      await Promise.all([first, second]);

      expect(deleteArticle).not.toHaveBeenCalled();
      expect(putArticle).toHaveBeenLastCalledWith(
        expect.objectContaining({ content_md: "edited body" }),
      );
      expect(store.isCached("1")).toBe(true);
    });

    test("a superseded save that fails doesn't undo the newer one", async () => {
      const firstWrite = deferred();
      putArticle.mockReturnValueOnce(firstWrite.promise);
      const store = useOfflineCacheStore();

      const first = store.cacheBookmark(makeBookmark());
      await vi.waitFor(() => expect(putArticle).toHaveBeenCalledTimes(1));
      const second = store.refreshCached(makeBookmark({ content_md: "edited body" }));
      firstWrite.reject(new Error("QuotaExceededError"));

      await expect(first).rejects.toThrow("QuotaExceededError");
      await second;
      expect(store.isCached("1")).toBe(true);
    });
  });
});
