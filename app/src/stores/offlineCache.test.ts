import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Bookmark } from "../lib/supabase";

const { putArticle, deleteArticle, listCachedArticleIds } = vi.hoisted(() => ({
  putArticle: vi.fn(),
  deleteArticle: vi.fn(),
  listCachedArticleIds: vi.fn(),
}));
vi.mock("../lib/offlineDb", () => ({ putArticle, deleteArticle, listCachedArticleIds }));

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
    thumbnail_url: "https://cdn.example.com/thumb.png",
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

describe("useOfflineCacheStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    listCachedArticleIds.mockResolvedValue([]);
    putArticle.mockResolvedValue(undefined);
    deleteArticle.mockResolvedValue(undefined);
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
});
