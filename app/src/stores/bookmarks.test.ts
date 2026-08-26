import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Bookmark } from "../lib/supabase";

const { from, getUser, invoke, storageRemove, storageCreateSignedUrl } = vi.hoisted(() => ({
  from: vi.fn(),
  getUser: vi.fn(),
  invoke: vi.fn(),
  storageRemove: vi.fn(),
  storageCreateSignedUrl: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({
  supabase: {
    from,
    auth: { getUser },
    functions: { invoke },
    storage: {
      from: () => ({ remove: storageRemove, createSignedUrl: storageCreateSignedUrl }),
    },
  },
}));

const {
  replaceBookmarksList,
  getBookmarksList,
  getArticle,
  deleteBookmarkMeta,
  hydrateArticleContent,
} = vi.hoisted(() => ({
  replaceBookmarksList: vi.fn(),
  getBookmarksList: vi.fn(),
  getArticle: vi.fn(),
  deleteBookmarkMeta: vi.fn(),
  hydrateArticleContent: vi.fn((article: { content_md: string }) => article.content_md),
}));
vi.mock("../lib/offlineDb", () => ({
  replaceBookmarksList,
  getBookmarksList,
  getArticle,
  deleteBookmarkMeta,
  hydrateArticleContent,
}));

const { removeCachedBookmark } = vi.hoisted(() => ({ removeCachedBookmark: vi.fn() }));
vi.mock("./offlineCache", () => ({ useOfflineCacheStore: () => ({ removeCachedBookmark }) }));

const { useBookmarksStore } = await import("./bookmarks");

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
    progress: 0,
    ...overrides,
  };
}

describe("useBookmarksStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    replaceBookmarksList.mockResolvedValue(undefined);
    getBookmarksList.mockResolvedValue([]);
    getArticle.mockResolvedValue(undefined);
    deleteBookmarkMeta.mockResolvedValue(undefined);
    removeCachedBookmark.mockResolvedValue(undefined);
    hydrateArticleContent.mockImplementation(
      (article: { content_md: string }) => article.content_md,
    );
  });

  test("fetch loads bookmarks ordered by the query and exposes them", async () => {
    const rows = [makeBookmark({ id: "1" }), makeBookmark({ id: "2", archived: true })];
    const order = vi.fn().mockResolvedValue({ data: rows, error: null });
    const select = vi.fn(() => ({ order }));
    from.mockReturnValue({ select });

    const store = useBookmarksStore();
    await store.fetch();

    expect(from).toHaveBeenCalledWith("bookmarks");
    expect(store.bookmarks).toHaveLength(2);
  });

  test("fetch requests a list projection without article bodies or the search vector", async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const select = vi.fn((_cols: string) => ({ order }));
    from.mockReturnValue({ select });

    const store = useBookmarksStore();
    await store.fetch();

    const requestedColumns = select.mock.calls[0][0];
    expect(requestedColumns).not.toContain("content_md");
    expect(requestedColumns).not.toContain("translated_content_md");
    expect(requestedColumns).not.toContain("search_vector");
    expect(requestedColumns).not.toBe("*, tags(id, name, color)");
    expect(requestedColumns).toContain("tags(id, name, color)");
    expect(requestedColumns).toContain("translated_lang");
  });

  test("fetchOne requests the full row including article bodies", async () => {
    const row = makeBookmark({ id: "solo" });
    const single = vi.fn().mockResolvedValue({ data: row, error: null });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    from.mockReturnValue({ select });

    const store = useBookmarksStore();
    await store.fetchOne("solo");

    expect(select).toHaveBeenCalledWith("*, tags(id, name, color)");
  });

  test("polling preserves an already-loaded article body when a row's status changes", async () => {
    const seedRows = [makeBookmark({ id: "1", status: "pending", content_md: "loaded body" })];
    const seedOrder = vi.fn().mockResolvedValue({ data: seedRows, error: null });
    const lightOrder = vi.fn().mockResolvedValue({
      data: [{ id: "1", status: "ready", archived: false, read_at: null }],
      error: null,
    });
    // The stale-row re-fetch uses the list projection, so it has no content_md.
    const inMock = vi.fn().mockResolvedValue({
      data: [{ id: "1", status: "ready", title: "Title", archived: false, read_at: null }],
      error: null,
    });
    const select = vi.fn((cols: string) =>
      cols === "id, status, archived, read_at"
        ? { order: lightOrder }
        : { order: seedOrder, in: inMock },
    );
    from.mockReturnValue({ select });

    const store = useBookmarksStore();
    await store.fetch();

    vi.useFakeTimers();
    store.startPolling();
    await vi.advanceTimersByTimeAsync(5000);
    vi.useRealTimers();

    expect(store.bookmarks[0]?.status).toBe("ready");
    expect(store.bookmarks[0]?.content_md).toBe("loaded body");
  });

  test("visibleBookmarks shows non-archived rows on the 'all' filter", async () => {
    const rows = [
      makeBookmark({ id: "1", archived: false }),
      makeBookmark({ id: "2", archived: true }),
    ];
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
    });

    const store = useBookmarksStore();
    await store.fetch();
    store.setFilter("all");

    expect(store.visibleBookmarks.map((b) => b.id)).toEqual(["1"]);
  });

  test("visibleBookmarks shows only archived rows on the 'archived' filter", async () => {
    const rows = [
      makeBookmark({ id: "1", archived: false }),
      makeBookmark({ id: "2", archived: true }),
    ];
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
    });

    const store = useBookmarksStore();
    await store.fetch();
    store.setFilter("archived");

    expect(store.visibleBookmarks.map((b) => b.id)).toEqual(["2"]);
  });

  test("unreadCount counts non-archived items with no read_at", async () => {
    const rows = [
      makeBookmark({ id: "1", archived: false, read_at: null }),
      makeBookmark({ id: "2", archived: false, read_at: "2026-01-02T00:00:00Z" }),
      makeBookmark({ id: "3", archived: true, read_at: null }),
    ];
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
    });

    const store = useBookmarksStore();
    await store.fetch();

    expect(store.unreadCount).toBe(1);
  });

  test("markRead updates the row's read_at both remotely and in local state", async () => {
    const rows = [makeBookmark({ id: "1", read_at: null })];
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
      update,
    });

    const store = useBookmarksStore();
    await store.fetch();
    await store.markRead("1");

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ read_at: expect.any(String) }));
    expect(eq).toHaveBeenCalledWith("id", "1");
    expect(store.bookmarks[0]?.read_at).not.toBeNull();
  });

  test("markUnread clears the row's read_at both remotely and in local state", async () => {
    const rows = [makeBookmark({ id: "1", read_at: "2026-01-02T00:00:00Z" })];
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
      update,
    });

    const store = useBookmarksStore();
    await store.fetch();
    await store.markUnread("1");

    expect(update).toHaveBeenCalledWith({ read_at: null });
    expect(eq).toHaveBeenCalledWith("id", "1");
    expect(store.bookmarks[0]?.read_at).toBeNull();
  });

  test("archive updates the row's archived flag both remotely and in local state", async () => {
    const rows = [makeBookmark({ id: "1", archived: false })];
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
      update,
    });

    const store = useBookmarksStore();
    await store.fetch();
    await store.archive("1");

    expect(update).toHaveBeenCalledWith({ archived: true });
    expect(store.bookmarks[0]?.archived).toBe(true);
  });

  test("fetchOne adds a not-yet-loaded bookmark into local state and returns it", async () => {
    const row = makeBookmark({ id: "solo" });
    const eq = vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: row, error: null }) }));
    const select = vi.fn(() => ({ eq }));
    from.mockReturnValue({ select });

    const store = useBookmarksStore();
    const result = await store.fetchOne("solo");

    expect(result?.id).toBe("solo");
    expect(store.bookmarks.map((b) => b.id)).toContain("solo");
  });

  test("add inserts a pending bookmark for the signed-in user and prepends it locally", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const inserted = makeBookmark({ id: "new", url: "https://arc90.com/new", status: "pending" });
    const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    from.mockReturnValue({ insert });

    const store = useBookmarksStore();
    const result = await store.add("https://arc90.com/new");

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://arc90.com/new",
        type: "article",
        status: "pending",
        user_id: "user-1",
      }),
    );
    expect(result.error).toBeNull();
    expect(store.bookmarks[0]?.id).toBe("new");
  });

  test("add returns an error and does not touch local state when not signed in", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const store = useBookmarksStore();
    const result = await store.add("https://arc90.com/new");

    expect(result.error).toBeTruthy();
    expect(from).not.toHaveBeenCalled();
    expect(store.bookmarks).toHaveLength(0);
  });

  test("add returns an error for an unparseable URL", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const store = useBookmarksStore();
    const result = await store.add("not a url");

    expect(result.error).toBeTruthy();
    expect(from).not.toHaveBeenCalled();
  });

  test("add reports a duplicate and skips inserting when the URL is already saved", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const rows = [makeBookmark({ id: "1", url: "https://arc90.com/x" })];
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
    });

    const store = useBookmarksStore();
    await store.fetch();
    from.mockClear();

    const result = await store.add("https://arc90.com/x");

    expect(result).toEqual({ error: null, duplicate: true });
    expect(from).not.toHaveBeenCalled();
  });

  test("add with force: true skips the duplicate check and inserts anyway", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const rows = [makeBookmark({ id: "1", url: "https://arc90.com/x" })];
    from.mockReturnValueOnce({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
    });

    const store = useBookmarksStore();
    await store.fetch();

    const inserted = makeBookmark({ id: "new", url: "https://arc90.com/x", status: "pending" });
    const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    from.mockReturnValueOnce({ insert });

    const result = await store.add("https://arc90.com/x", { force: true });

    expect(insert).toHaveBeenCalled();
    expect(result.error).toBeNull();
    expect(store.bookmarks[0]?.id).toBe("new");
  });

  test("add passes an optional title through to the insert", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const inserted = makeBookmark({ id: "new", url: "https://arc90.com/new", status: "pending" });
    const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    from.mockReturnValue({ insert });

    const store = useBookmarksStore();
    await store.add("https://arc90.com/new", { title: "A great article" });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ title: "A great article" }));
  });

  test("fetchOne replaces the existing local copy rather than duplicating it", async () => {
    const original = makeBookmark({ id: "1", title: "Old title" });
    const updated = makeBookmark({ id: "1", title: "New title" });
    from.mockReturnValueOnce({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: [original], error: null }) }),
    });

    const store = useBookmarksStore();
    await store.fetch();

    from.mockReturnValueOnce({
      select: () => ({
        eq: () => ({ single: vi.fn().mockResolvedValue({ data: updated, error: null }) }),
      }),
    });
    await store.fetchOne("1");

    expect(store.bookmarks).toHaveLength(1);
    expect(store.bookmarks[0]?.title).toBe("New title");
  });

  test("fetch persists list metadata without article content to the offline store on success", async () => {
    const rows = [makeBookmark({ id: "1", content_md: "full text" })];
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
    });

    const store = useBookmarksStore();
    await store.fetch();

    expect(replaceBookmarksList).toHaveBeenCalledTimes(1);
    const [persisted] = replaceBookmarksList.mock.calls[0] as [Record<string, unknown>[]];
    expect(persisted).toEqual([expect.objectContaining({ id: "1", title: "Title" })]);
    expect(persisted[0]).not.toHaveProperty("content_md");
  });

  test("fetch keeps the freshly loaded list even if persisting the offline copy fails", async () => {
    const rows = [makeBookmark({ id: "1" })];
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
    });
    replaceBookmarksList.mockRejectedValue(new Error("private browsing: indexedDB disabled"));

    const store = useBookmarksStore();
    await store.fetch();

    expect(store.bookmarks).toHaveLength(1);
    expect(store.bookmarks[0]?.id).toBe("1");
  });

  test("fetch falls back to the offline cache when the network request fails", async () => {
    const order = vi.fn().mockRejectedValue(new Error("offline"));
    from.mockReturnValue({ select: () => ({ order }) });
    getBookmarksList.mockResolvedValue([
      {
        id: "1",
        url: "https://arc90.com/x",
        type: "article",
        status: "ready",
        title: "Cached title",
        author: null,
        excerpt: null,
        thumbnail_url: null,
        word_count: null,
        reading_time: null,
        tags: [],
        is_public: false,
        archived: false,
        read_at: null,
        error_message: null,
        created_at: "2026-01-01T00:00:00Z",
        processed_at: null,
      },
    ]);
    getArticle.mockResolvedValue({
      id: "1",
      content_md: "cached body",
      images: [],
      cachedAt: "2026-01-01T00:00:00Z",
    });

    const store = useBookmarksStore();
    await store.fetch();

    expect(store.bookmarks).toHaveLength(1);
    expect(store.bookmarks[0]?.title).toBe("Cached title");
    expect(store.bookmarks[0]?.content_md).toBe("cached body");
    expect(replaceBookmarksList).not.toHaveBeenCalled();
  });

  test("fetch falls back to the offline cache when supabase returns an error object without throwing", async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { message: "fetch failed" } });
    from.mockReturnValue({ select: () => ({ order }) });
    getBookmarksList.mockResolvedValue([
      {
        id: "1",
        url: "https://arc90.com/x",
        type: "article",
        status: "ready",
        title: "Offline title",
        author: null,
        excerpt: null,
        thumbnail_url: null,
        word_count: null,
        reading_time: null,
        tags: [],
        is_public: false,
        archived: false,
        read_at: null,
        error_message: null,
        created_at: "2026-01-01T00:00:00Z",
        processed_at: null,
      },
    ]);

    const store = useBookmarksStore();
    await store.fetch();

    expect(store.bookmarks).toHaveLength(1);
    expect(store.bookmarks[0]?.title).toBe("Offline title");
    expect(replaceBookmarksList).not.toHaveBeenCalled();
  });

  test("archive evicts the bookmark from the offline article cache", async () => {
    const rows = [makeBookmark({ id: "1", archived: false })];
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
      update,
    });

    const store = useBookmarksStore();
    await store.fetch();
    await store.archive("1");

    expect(removeCachedBookmark).toHaveBeenCalledWith("1");
  });

  test("addNote inserts a ready note for the signed-in user and prepends it locally", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const inserted = makeBookmark({
      id: "note-1",
      url: null,
      type: "note",
      status: "ready",
      content_md: "hello",
    });
    const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    from.mockReturnValue({ insert });

    const store = useBookmarksStore();
    const result = await store.addNote("hello");

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        url: null,
        type: "note",
        status: "ready",
        content_md: "hello",
        user_id: "user-1",
      }),
    );
    expect(result.error).toBeNull();
    expect(store.bookmarks[0]?.id).toBe("note-1");
  });

  test("addNote returns an error for blank text without touching the network", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const store = useBookmarksStore();
    const result = await store.addNote("   ");

    expect(result.error).toBeTruthy();
    expect(from).not.toHaveBeenCalled();
  });

  test("addSnippet invokes the snippet edge function and prepends the returned bookmark", async () => {
    const inserted = makeBookmark({
      id: "snippet-1",
      url: null,
      type: "note",
      content_md: "**bold**",
    });
    invoke.mockResolvedValue({ data: { bookmark: inserted }, error: null });

    const store = useBookmarksStore();
    const result = await store.addSnippet("<b>bold</b>", "bold");

    expect(invoke).toHaveBeenCalledWith("snippet", { body: { html: "<b>bold</b>", text: "bold" } });
    expect(result.error).toBeNull();
    expect(store.bookmarks[0]?.id).toBe("snippet-1");
  });

  test("addSnippet propagates an error from the edge function without touching local state", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "snippet is empty" } });

    const store = useBookmarksStore();
    const result = await store.addSnippet("", "");

    expect(result.error).toBe("snippet is empty");
    expect(store.bookmarks).toHaveLength(0);
  });

  test("addFile invokes file-import for a markdown file and prepends the returned bookmark", async () => {
    const inserted = makeBookmark({ id: "file-1", url: null, type: "note", content_md: "# hi" });
    invoke.mockResolvedValue({ data: { bookmark: inserted }, error: null });
    const file = new File(["# hi"], "notes.md", { type: "text/markdown" });

    const store = useBookmarksStore();
    const result = await store.addFile(file);

    expect(invoke).toHaveBeenCalledWith(
      "file-import",
      expect.objectContaining({ body: expect.objectContaining({ filename: "notes.md" }) }),
    );
    expect(result.error).toBeNull();
    expect(store.bookmarks[0]?.id).toBe("file-1");
  });

  test("addFile rejects unsupported extensions without calling the edge function", async () => {
    const store = useBookmarksStore();
    const result = await store.addFile(new File(["x"], "legacy.doc"));

    expect(result.error).toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
  });

  test("addFile rejects an oversized markdown file without calling the edge function", async () => {
    const store = useBookmarksStore();
    const big = "a".repeat(500 * 1024 + 1);
    const result = await store.addFile(new File([big], "big.md"));

    expect(result.error).toContain("500KB");
    expect(invoke).not.toHaveBeenCalled();
  });

  test("addPdf invokes pdf-import and prepends the returned bookmark", async () => {
    const inserted = makeBookmark({
      id: "pdf-1",
      url: null,
      type: "pdf",
      pdf_path: "user-1/abc.pdf",
      pdf_parsed: true,
    });
    invoke.mockResolvedValue({ data: { bookmark: inserted }, error: null });
    const file = new File(["%PDF-1.4"], "report.pdf", { type: "application/pdf" });

    const store = useBookmarksStore();
    const result = await store.addPdf(file);

    expect(invoke).toHaveBeenCalledWith(
      "pdf-import",
      expect.objectContaining({ body: expect.objectContaining({ filename: "report.pdf" }) }),
    );
    expect(result.error).toBeNull();
    expect(store.bookmarks[0]?.id).toBe("pdf-1");
  });

  test("addPdf rejects a file over the 20MB limit without calling the edge function", async () => {
    const store = useBookmarksStore();
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    const result = await store.addPdf(new File([big], "big.pdf"));

    expect(result.error).toContain("20MB");
    expect(invoke).not.toHaveBeenCalled();
  });

  test("setViewMode persists the toggle and updates local state", async () => {
    const rows = [
      makeBookmark({ id: "1", type: "pdf", pdf_path: "user-1/a.pdf", pdf_parsed: true }),
    ];
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
    });
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));

    const store = useBookmarksStore();
    await store.fetch();
    from.mockReturnValue({ update });

    await store.setViewMode("1", "original");

    expect(update).toHaveBeenCalledWith({ view_mode: "original" });
    expect(store.bookmarks[0]?.view_mode).toBe("original");
  });

  test("getPdfSignedUrl returns a signed url on success", async () => {
    storageCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://example.com/signed" },
      error: null,
    });

    const store = useBookmarksStore();
    const result = await store.getPdfSignedUrl("user-1/a.pdf");

    expect(storageCreateSignedUrl).toHaveBeenCalledWith("user-1/a.pdf", 60);
    expect(result).toEqual({ url: "https://example.com/signed", error: null });
  });

  test("getPdfSignedUrl propagates a storage error", async () => {
    storageCreateSignedUrl.mockResolvedValue({ data: null, error: { message: "not found" } });

    const store = useBookmarksStore();
    const result = await store.getPdfSignedUrl("user-1/missing.pdf");

    expect(result).toEqual({ url: null, error: "not found" });
  });

  test("trashOriginalPdf removes the storage object and clears pdf_path locally", async () => {
    const rows = [
      makeBookmark({ id: "1", type: "pdf", pdf_path: "user-1/a.pdf", pdf_parsed: true }),
    ];
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
    });
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    storageRemove.mockResolvedValue({ error: null });

    const store = useBookmarksStore();
    await store.fetch();
    from.mockReturnValue({ update });

    const result = await store.trashOriginalPdf("1");

    expect(storageRemove).toHaveBeenCalledWith(["user-1/a.pdf"]);
    expect(update).toHaveBeenCalledWith({ pdf_path: null, view_mode: "markdown" });
    expect(result.error).toBeNull();
    expect(store.bookmarks[0]?.pdf_path).toBeNull();
    expect(store.bookmarks[0]?.view_mode).toBe("markdown");
  });

  test("trashOriginalPdf is a no-op when there's no original to trash", async () => {
    const result = await useBookmarksStore().trashOriginalPdf("missing");

    expect(result.error).toBeNull();
    expect(storageRemove).not.toHaveBeenCalled();
  });

  test("translateBookmark invokes the translate edge function with the bookmark id and caches the result locally", async () => {
    const rows = [makeBookmark({ id: "1", content_md: "Bonjour" })];
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
    });
    invoke.mockResolvedValue({
      data: { translated_text: "Hello", translated_lang: "EN" },
      error: null,
    });

    const store = useBookmarksStore();
    await store.fetch();
    const result = await store.translateBookmark("1", "Bonjour", "EN");

    expect(invoke).toHaveBeenCalledWith("translate", {
      body: { bookmark_id: "1", text: "Bonjour", target_lang: "EN" },
    });
    expect(result).toEqual({ translatedText: "Hello", error: null });
    expect(store.bookmarks[0]?.translated_content_md).toBe("Hello");
    expect(store.bookmarks[0]?.translated_lang).toBe("EN");
  });

  test("translateBookmark propagates an error from the edge function without touching local state", async () => {
    const rows = [makeBookmark({ id: "1", content_md: "Bonjour" })];
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
    });
    invoke.mockResolvedValue({ data: null, error: { message: "DeepL error" } });

    const store = useBookmarksStore();
    await store.fetch();
    const result = await store.translateBookmark("1", "Bonjour", "EN");

    expect(result).toEqual({ translatedText: null, error: "DeepL error" });
    expect(store.bookmarks[0]?.translated_content_md).toBeNull();
  });

  test("setPublic updates is_public both remotely and in local state", async () => {
    const rows = [makeBookmark({ id: "1", is_public: false })];
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
      update,
    });

    const store = useBookmarksStore();
    await store.fetch();
    await store.setPublic("1", true);

    expect(update).toHaveBeenCalledWith({ is_public: true });
    expect(eq).toHaveBeenCalledWith("id", "1");
    expect(store.bookmarks[0]?.is_public).toBe(true);
  });

  test("refresh resets a bookmark to pending both remotely and in local state", async () => {
    const rows = [makeBookmark({ id: "1", status: "failed", error_message: "boom" })];
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
      update,
    });

    const store = useBookmarksStore();
    await store.fetch();
    await store.refresh("1");

    expect(update).toHaveBeenCalledWith({
      status: "pending",
      error_message: null,
      content_edited: false,
    });
    expect(store.bookmarks[0]?.status).toBe("pending");
    expect(store.bookmarks[0]?.error_message).toBeNull();
  });

  test("refresh asks for confirmation before overwriting a manually-edited bookmark", async () => {
    const rows = [
      makeBookmark({ id: "1", status: "failed", error_message: "boom", content_edited: true }),
    ];
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
      update,
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const store = useBookmarksStore();
    await store.fetch();
    await store.refresh("1");

    expect(confirmSpy).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      status: "pending",
      error_message: null,
      content_edited: false,
    });
    expect(store.bookmarks[0]?.status).toBe("pending");
  });

  test("refresh looks up content_edited remotely when the bookmark isn't loaded locally", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { content_edited: true } });
    const eqSelect = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq: eqSelect }));
    const eqUpdate = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq: eqUpdate }));
    from.mockReturnValue({ select, update });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const store = useBookmarksStore();
    await store.refresh("not-loaded-id");

    expect(select).toHaveBeenCalledWith("content_edited");
    expect(eqSelect).toHaveBeenCalledWith("id", "not-loaded-id");
    expect(confirmSpy).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      status: "pending",
      error_message: null,
      content_edited: false,
    });
  });

  test("refresh does nothing if the user declines the manual-edit confirmation", async () => {
    const rows = [
      makeBookmark({ id: "1", status: "failed", error_message: "boom", content_edited: true }),
    ];
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
      update,
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const store = useBookmarksStore();
    await store.fetch();
    await store.refresh("1");

    expect(update).not.toHaveBeenCalled();
    expect(store.bookmarks[0]?.status).toBe("failed");
  });

  test("updateContent saves title/content_md/word_count/reading_time, marks content_edited, and updates local state", async () => {
    const rows = [makeBookmark({ id: "1", title: "Old title", content_md: "old content" })];
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
      update,
    });

    const store = useBookmarksStore();
    await store.fetch();
    await store.updateContent("1", {
      title: "New title",
      content_md: "new content here",
      word_count: 3,
      reading_time: 1,
    });

    expect(update).toHaveBeenCalledWith({
      title: "New title",
      content_md: "new content here",
      word_count: 3,
      reading_time: 1,
      content_edited: true,
      translated_content_md: null,
      translated_lang: null,
    });
    expect(eq).toHaveBeenCalledWith("id", "1");
    expect(store.bookmarks[0]?.title).toBe("New title");
    expect(store.bookmarks[0]?.content_md).toBe("new content here");
    expect(store.bookmarks[0]?.content_edited).toBe(true);
  });

  test("updateContent clears a previously cached translation, since it no longer matches the edited text", async () => {
    const rows = [
      makeBookmark({
        id: "1",
        content_md: "old content",
        translated_content_md: "stale translation",
        translated_lang: "EN",
      }),
    ];
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
      update,
    });

    const store = useBookmarksStore();
    await store.fetch();
    await store.updateContent("1", {
      title: "Title",
      content_md: "new content here",
      word_count: 3,
      reading_time: 1,
    });

    expect(store.bookmarks[0]?.translated_content_md).toBeNull();
    expect(store.bookmarks[0]?.translated_lang).toBeNull();
  });

  test("add reports a duplicate via the DB unique index when the URL wasn't in the local list", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const single = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: "23505", message: "conflict" } });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    from.mockReturnValueOnce({ insert });

    const existing = {
      id: "existing-1",
      title: "Already saved",
      created_at: "2026-01-01T00:00:00Z",
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const lookupSelect = vi.fn(() => ({ eq }));
    from.mockReturnValueOnce({ select: lookupSelect });

    const store = useBookmarksStore();
    const result = await store.add("https://arc90.com/new");

    expect(result).toEqual({
      error: null,
      duplicate: true,
      existingId: "existing-1",
      existingTitle: "Already saved",
      existingSavedAt: "2026-01-01T00:00:00Z",
    });
  });

  test("addTag creates the tag, links it, and updates local state", async () => {
    const rows = [makeBookmark({ id: "1", tags: [] })];
    const tag = { id: "tag-1", name: "vue", color: "#888888" };
    const tagSingle = vi.fn().mockResolvedValue({ data: tag, error: null });
    const tagSelect = vi.fn(() => ({ single: tagSingle }));
    const tagUpsert = vi.fn(() => ({ select: tagSelect }));
    const joinUpsert = vi.fn().mockResolvedValue({ error: null });

    from.mockImplementation((table: string) => {
      if (table === "tags") return { upsert: tagUpsert };
      if (table === "bookmark_tags") return { upsert: joinUpsert };
      return { select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }) };
    });

    const store = useBookmarksStore();
    await store.fetch();
    await store.addTag("1", "vue");

    expect(tagUpsert).toHaveBeenCalledWith(
      { name: "vue" },
      { onConflict: "name", ignoreDuplicates: false },
    );
    expect(joinUpsert).toHaveBeenCalledWith(
      { bookmark_id: "1", tag_id: "tag-1" },
      { onConflict: "bookmark_id,tag_id" },
    );
    expect(store.bookmarks[0]?.tags).toEqual([tag]);
  });

  test("removeTag unlinks the tag and updates local state", async () => {
    const tag = { id: "tag-1", name: "vue", color: "#888888" };
    const rows = [makeBookmark({ id: "1", tags: [tag] })];
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const del = vi.fn(() => ({ eq: eq1 }));

    from.mockImplementation((table: string) => {
      if (table === "bookmark_tags") return { delete: del };
      return { select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }) };
    });

    const store = useBookmarksStore();
    await store.fetch();
    await store.removeTag("1", "tag-1");

    expect(del).toHaveBeenCalled();
    expect(eq1).toHaveBeenCalledWith("bookmark_id", "1");
    expect(eq2).toHaveBeenCalledWith("tag_id", "tag-1");
    expect(store.bookmarks[0]?.tags).toEqual([]);
  });

  test("remove deletes the row remotely, drops it locally, and evicts offline data", async () => {
    const rows = [makeBookmark({ id: "1" })];
    const eq = vi.fn().mockResolvedValue({ error: null });
    const del = vi.fn(() => ({ eq }));
    from.mockReturnValue({
      select: () => ({ order: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
      delete: del,
    });

    const store = useBookmarksStore();
    await store.fetch();
    await store.remove("1");

    expect(del).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith("id", "1");
    expect(store.bookmarks).toHaveLength(0);
    expect(deleteBookmarkMeta).toHaveBeenCalledWith("1");
    expect(removeCachedBookmark).toHaveBeenCalledWith("1");
  });

  describe("polling", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test("startPolling re-fetches on an interval to pick up remote changes", async () => {
      const order = vi.fn().mockResolvedValue({ data: [], error: null });
      from.mockReturnValue({ select: () => ({ order }) });

      const store = useBookmarksStore();
      store.startPolling();

      expect(order).toHaveBeenCalledTimes(0);
      await vi.advanceTimersByTimeAsync(5000);
      expect(order).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5000);
      expect(order).toHaveBeenCalledTimes(2);
    });

    test("startPolling requests a lightweight column set, not full article content", async () => {
      const order = vi.fn().mockResolvedValue({ data: [], error: null });
      const select = vi.fn((_cols: string) => ({ order }));
      from.mockReturnValue({ select });

      const store = useBookmarksStore();
      store.startPolling();
      await vi.advanceTimersByTimeAsync(5000);

      expect(select).toHaveBeenCalledTimes(1);
      const requestedColumns = select.mock.calls[0][0];
      expect(requestedColumns).not.toContain("content_md");
    });

    test("startPolling only re-fetches full content for bookmarks whose status changed", async () => {
      const seedRows = [
        makeBookmark({ id: "1", status: "ready", title: "Unchanged" }),
        makeBookmark({ id: "2", status: "pending", title: "Stale" }),
      ];
      const seedOrder = vi.fn().mockResolvedValue({ data: seedRows, error: null });
      const lightOrder = vi.fn().mockResolvedValue({
        data: [
          { id: "1", status: "ready", archived: false, read_at: null },
          { id: "2", status: "ready", archived: false, read_at: null },
        ],
        error: null,
      });
      const inMock = vi.fn().mockResolvedValue({
        data: [makeBookmark({ id: "2", status: "ready", title: "Now ready" })],
        error: null,
      });

      const select = vi.fn((cols: string) =>
        cols === "id, status, archived, read_at"
          ? { order: lightOrder }
          : { order: seedOrder, in: inMock },
      );
      from.mockReturnValue({ select });

      const store = useBookmarksStore();
      await store.fetch();

      store.startPolling();
      await vi.advanceTimersByTimeAsync(5000);

      expect(inMock).toHaveBeenCalledWith("id", ["2"]);
      expect(store.bookmarks.find((b) => b.id === "2")?.title).toBe("Now ready");
      expect(store.bookmarks.find((b) => b.id === "1")?.title).toBe("Unchanged");
    });

    test("startPolling skips the full-content query entirely when nothing changed", async () => {
      const seedRows = [makeBookmark({ id: "1", status: "ready" })];
      const seedOrder = vi.fn().mockResolvedValue({ data: seedRows, error: null });
      const lightOrder = vi.fn().mockResolvedValue({
        data: [{ id: "1", status: "ready", archived: false, read_at: null }],
        error: null,
      });
      const inMock = vi.fn();

      const select = vi.fn((cols: string) =>
        cols === "id, status, archived, read_at"
          ? { order: lightOrder }
          : { order: seedOrder, in: inMock },
      );
      from.mockReturnValue({ select });

      const store = useBookmarksStore();
      await store.fetch();

      store.startPolling();
      await vi.advanceTimersByTimeAsync(5000);

      expect(inMock).not.toHaveBeenCalled();
    });

    test("stopPolling cancels further re-fetches", async () => {
      const order = vi.fn().mockResolvedValue({ data: [], error: null });
      from.mockReturnValue({ select: () => ({ order }) });

      const store = useBookmarksStore();
      store.startPolling();
      await vi.advanceTimersByTimeAsync(5000);
      expect(order).toHaveBeenCalledTimes(1);

      store.stopPolling();
      await vi.advanceTimersByTimeAsync(15000);
      expect(order).toHaveBeenCalledTimes(1);
    });

    test("startPolling is idempotent — calling it again doesn't stack extra timers", async () => {
      const order = vi.fn().mockResolvedValue({ data: [], error: null });
      from.mockReturnValue({ select: () => ({ order }) });

      const store = useBookmarksStore();
      store.startPolling();
      store.startPolling();
      await vi.advanceTimersByTimeAsync(5000);

      expect(order).toHaveBeenCalledTimes(1);
    });
  });

  describe("updateProgress", () => {
    test("updates progress on local bookmark and calls supabase update", async () => {
      const eqUpdate = vi.fn().mockResolvedValue({ error: null });
      const update = vi.fn(() => ({ eq: eqUpdate }));
      from.mockReturnValue({ update });

      const store = useBookmarksStore();
      const bm = makeBookmark({ id: "bm-1", progress: 0 });
      store.bookmarks = [bm];

      await store.updateProgress("bm-1", 0.4258);

      expect(store.bookmarks[0].progress).toBe(0.4258);
      expect(update).toHaveBeenCalledWith({ progress: 0.4258 });
      expect(eqUpdate).toHaveBeenCalledWith("id", "bm-1");
    });
  });
});
