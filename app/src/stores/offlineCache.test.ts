import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Bookmark } from "../lib/supabase";

const { putArticle, deleteArticle, listCachedArticleIds, getArticle } = vi.hoisted(() => ({
  putArticle: vi.fn(),
  deleteArticle: vi.fn(),
  listCachedArticleIds: vi.fn(),
  getArticle: vi.fn(),
}));
vi.mock("../lib/offlineDb", () => ({
  putArticle,
  deleteArticle,
  listCachedArticleIds,
  getArticle,
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
    listCachedArticleIds.mockResolvedValue([]);
    putArticle.mockResolvedValue(undefined);
    deleteArticle.mockResolvedValue(undefined);
    getArticle.mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ blob: () => Promise.resolve(new Blob(["x"])) }),
    );
  });

  test("init loads already-cached ids so isCached reflects prior sessions", async () => {
    listCachedArticleIds.mockResolvedValue(["1", "2"]);

    const store = useOfflineCacheStore();
    await store.init();

    expect(store.isCached("1")).toBe(true);
    expect(store.isCached("3")).toBe(false);
  });

  test("cacheBookmark fetches every image referenced in content and thumbnail, then persists the article", async () => {
    const store = useOfflineCacheStore();
    await store.cacheBookmark(makeBookmark());

    expect(fetch).toHaveBeenCalledWith("https://cdn.example.com/a.png");
    expect(fetch).toHaveBeenCalledWith("https://cdn.example.com/thumb.png");
    expect(putArticle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "1", content_md: expect.stringContaining("body text") }),
    );
    expect(store.isCached("1")).toBe(true);
  });

  test("cacheBookmark still caches the text when an image fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const store = useOfflineCacheStore();
    await store.cacheBookmark(makeBookmark());

    expect(putArticle).toHaveBeenCalledWith(expect.objectContaining({ id: "1", images: [] }));
    expect(store.isCached("1")).toBe(true);
  });

  test("cacheBookmark is a no-op when the article is already cached in this session", async () => {
    const store = useOfflineCacheStore();
    await store.cacheBookmark(makeBookmark());
    vi.mocked(fetch).mockClear();
    putArticle.mockClear();

    await store.cacheBookmark(makeBookmark());

    expect(fetch).not.toHaveBeenCalled();
    expect(putArticle).not.toHaveBeenCalled();
  });

  test("cacheBookmark is a no-op when the article was cached in a prior session", async () => {
    getArticle.mockResolvedValue({ id: "1", content_md: "x", images: [], cachedAt: "t" });

    const store = useOfflineCacheStore();
    await store.cacheBookmark(makeBookmark());

    expect(fetch).not.toHaveBeenCalled();
    expect(putArticle).not.toHaveBeenCalled();
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
      listCachedArticleIds.mockResolvedValue([]);
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
});
