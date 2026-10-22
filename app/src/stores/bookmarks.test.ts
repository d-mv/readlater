import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Bookmark } from "../lib/supabase";

const {
  from,
  invoke,
  storageRemove,
  storageRemoveFrom,
  storageCreateSignedUrl,
  channel,
  removeChannel,
  onSpy,
  authState,
} = vi.hoisted(() => {
  const onSpy = vi.fn();
  const channelObj = {
    on: (...args: unknown[]) => {
      onSpy(...args);
      return channelObj;
    },
    subscribe: () => channelObj,
  };
  return {
    from: vi.fn(),
    invoke: vi.fn(),
    storageRemove: vi.fn(),
    storageRemoveFrom: vi.fn(),
    storageCreateSignedUrl: vi.fn(),
    channel: vi.fn(() => channelObj),
    removeChannel: vi.fn(),
    onSpy,
    authState: {
      userId: "user-1" as string | null,
      session: { user: { id: "user-1" } } as unknown,
      checkSession: vi.fn(),
      sessionExpired: vi.fn(),
    },
  };
});
vi.mock("../lib/supabase", () => ({
  supabase: {
    from,
    functions: { invoke },
    channel,
    removeChannel,
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => {
          storageRemoveFrom(bucket, paths);
          return storageRemove(paths);
        },
        createSignedUrl: storageCreateSignedUrl,
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl: `https://proj.supabase.co/storage/v1/object/public/${bucket}/${path}`,
          },
        }),
      }),
    },
  },
}));
vi.mock("./auth", () => ({ useAuthStore: () => authState }));

/** Invoke the postgres_changes handler the store registered with .on(). */
function emitRealtime(payload: Record<string, unknown>) {
  const handler = onSpy.mock.calls.at(-1)?.[2] as (p: Record<string, unknown>) => void;
  handler(payload);
}

/**
 * Chainable stand-in for a PostgREST list query: every builder method returns
 * self, and awaiting it resolves with whatever `result` returns — by default
 * { data, error }.
 */
function listQuery(rows: unknown = [], error: unknown = null) {
  const self = {
    textSearch: vi.fn(() => self),
    or: vi.fn(() => self),
    gte: vi.fn(() => self),
    limit: vi.fn(() => self),
    order: vi.fn(() => self),
    result: vi.fn<() => Promise<unknown>>().mockResolvedValue({ data: rows, error }),
    // A PostgREST builder is itself a thenable (awaiting it sends the
    // request), which is exactly what this stand-in has to mirror.
    // oxlint-disable-next-line unicorn/no-thenable
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      return self.result().then(onFulfilled, onRejected);
    },
  };
  return self;
}

/** The PostgREST filter for "after this keyset cursor" in (created_at, id) desc order. */
function afterCursor(createdAt: string, id: string) {
  return `created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt."${id}")`;
}

const {
  replaceBookmarksList,
  getBookmarksList,
  getAllArticles,
  getArticle,
  deleteBookmarkMeta,
  putBookmarkMeta,
  hydrateArticleContent,
  dehydrateContent,
  getSyncState,
} = vi.hoisted(() => ({
  getSyncState: vi.fn(),
  replaceBookmarksList: vi.fn(),
  getBookmarksList: vi.fn(),
  getAllArticles: vi.fn(),
  getArticle: vi.fn(),
  deleteBookmarkMeta: vi.fn(),
  putBookmarkMeta: vi.fn(),
  hydrateArticleContent: vi.fn((article: { content_md: string }) => article.content_md),
  dehydrateContent: vi.fn((content: string) => content),
}));
vi.mock("../lib/offlineDb", () => ({
  getSyncState,
  replaceBookmarksList,
  getBookmarksList,
  getAllArticles,
  getArticle,
  deleteBookmarkMeta,
  putBookmarkMeta,
  hydrateArticleContent,
  dehydrateContent,
  stripContentMd: (b: any) => {
    const { content_md: _content_md, ...meta } = b;
    return meta;
  },
}));

const { removeCachedBookmark, refreshCached } = vi.hoisted(() => ({
  removeCachedBookmark: vi.fn(),
  refreshCached: vi.fn(),
}));
vi.mock("./offlineCache", () => ({
  useOfflineCacheStore: () => ({ removeCachedBookmark, refreshCached }),
}));

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
    updated_at: "2026-01-01T00:01:00Z",
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
    authState.userId = "user-1";
    authState.session = { user: { id: "user-1" } };
    authState.checkSession.mockResolvedValue(true);
    replaceBookmarksList.mockResolvedValue(undefined);
    getBookmarksList.mockResolvedValue([]);
    getAllArticles.mockResolvedValue([]);
    getArticle.mockResolvedValue(undefined);
    deleteBookmarkMeta.mockResolvedValue(undefined);
    putBookmarkMeta.mockResolvedValue(undefined);
    getSyncState.mockResolvedValue(undefined);
    removeCachedBookmark.mockResolvedValue(undefined);
    refreshCached.mockResolvedValue(undefined);
    hydrateArticleContent.mockImplementation(
      (article: { content_md: string }) => article.content_md,
    );
  });

  test("fetch loads bookmarks ordered by the query and exposes them", async () => {
    const rows = [makeBookmark({ id: "1" }), makeBookmark({ id: "2", archived: true })];
    const select = vi.fn(() => listQuery(rows));
    from.mockReturnValue({ select });

    const store = useBookmarksStore();
    await store.fetch();

    expect(from).toHaveBeenCalledWith("bookmarks");
    expect(store.bookmarks).toHaveLength(2);
  });

  test("fetch requests a list projection without article bodies or the search vector", async () => {
    const select = vi.fn((_cols: string) => listQuery([]));
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

  describe("an ended session", () => {
    test("online with no session in memory, a session supabase-js still has is used", async () => {
      authState.session = null;
      authState.checkSession.mockResolvedValue(true);
      from.mockReturnValue({ select: () => listQuery([makeBookmark({ id: "live" })]) });

      const store = useBookmarksStore();
      await store.fetch();

      expect(authState.checkSession).toHaveBeenCalledOnce();
      expect(store.bookmarks.map((b) => b.id)).toEqual(["live"]);
    });

    test("a session that is over shows no offline snapshot (the router leaves for login)", async () => {
      authState.session = null;
      authState.checkSession.mockImplementation(async () => {
        authState.userId = null;
        return false;
      });
      getBookmarksList.mockResolvedValue([makeBookmark({ id: "cached" })]);

      const store = useBookmarksStore();
      await store.fetch();

      expect(from).not.toHaveBeenCalled();
      expect(store.bookmarks).toEqual([]);
      expect(store.loading).toBe(false);
    });

    test("a 401 from the list query ends the login instead of falling back offline", async () => {
      const query = listQuery(null, { message: "JWT expired", code: "PGRST301" });
      query.result.mockResolvedValue({
        data: null,
        error: { message: "JWT expired" },
        status: 401,
      });
      from.mockReturnValue({ select: () => query });
      authState.sessionExpired.mockImplementation(() => {
        authState.userId = null;
      });
      getBookmarksList.mockResolvedValue([makeBookmark({ id: "cached" })]);

      const store = useBookmarksStore();
      await store.fetch();

      expect(authState.sessionExpired).toHaveBeenCalledOnce();
      expect(store.bookmarks).toEqual([]);
    });

    test("a 401 waits for the session check: still signed in → the offline snapshot", async () => {
      const query = listQuery(null);
      query.result.mockResolvedValue({ data: null, error: { message: "JWT" }, status: 401 });
      from.mockReturnValue({ select: () => query });
      authState.sessionExpired.mockImplementation(async () => {});
      getBookmarksList.mockResolvedValue([makeBookmark({ id: "cached" })]);

      const store = useBookmarksStore();
      await store.fetch();

      expect(store.bookmarks.map((b) => b.id)).toEqual(["cached"]);
    });

    test("a 401 waits for the session check: signed out → no snapshot", async () => {
      const query = listQuery(null);
      query.result.mockResolvedValue({ data: null, error: { message: "JWT" }, status: 401 });
      from.mockReturnValue({ select: () => query });
      authState.sessionExpired.mockImplementation(async () => {
        await Promise.resolve();
        authState.userId = null;
      });
      getBookmarksList.mockResolvedValue([makeBookmark({ id: "cached" })]);

      const store = useBookmarksStore();
      await store.fetch();

      expect(store.bookmarks).toEqual([]);
    });

    test("a 401 whose fetch was superseded during the session check leaves the list alone", async () => {
      const query = listQuery(null);
      query.result.mockResolvedValue({ data: null, error: { message: "JWT" }, status: 401 });
      from.mockReturnValue({ select: () => query });
      const store = useBookmarksStore();
      authState.sessionExpired.mockImplementation(async () => store.reset());
      getBookmarksList.mockResolvedValue([makeBookmark({ id: "cached" })]);

      await store.fetch();

      expect(getBookmarksList).not.toHaveBeenCalled();
      expect(store.bookmarks).toEqual([]);
    });

    test("an ordinary network error still falls back to the offline snapshot", async () => {
      from.mockReturnValue({ select: () => listQuery(null, { message: "Failed to fetch" }) });
      getBookmarksList.mockResolvedValue([makeBookmark({ id: "cached" })]);

      const store = useBookmarksStore();
      await store.fetch();

      expect(authState.sessionExpired).not.toHaveBeenCalled();
      expect(store.bookmarks.map((b) => b.id)).toEqual(["cached"]);
    });
  });

  test("reset empties the list and discards a fetch still in flight", async () => {
    from.mockReturnValueOnce({ select: () => listQuery([makeBookmark({ id: "a" })]) });
    const store = useBookmarksStore();
    await store.fetch();
    store.setSearchQuery("x");
    store.setFilter("archived");
    store.setActiveTagIds(["t1"]);

    let resolveOrder!: (value: unknown) => void;
    const slow = listQuery();
    slow.result.mockReturnValue(new Promise((r) => (resolveOrder = r)));
    from.mockReturnValueOnce({ select: () => slow });
    const inFlight = store.fetch();

    store.reset();
    resolveOrder({ data: [makeBookmark({ id: "late" })], error: null });
    await inFlight;

    expect(store.bookmarks).toEqual([]);
    expect(store.searchQuery).toBe("");
    expect(store.filter).toBe("all");
    expect(store.activeTagIds).toEqual([]);
    expect(store.hasMore).toBe(false);
  });

  describe("pagination", () => {
    const page = (n: number, offset = 0) =>
      Array.from({ length: n }, (_, i) =>
        makeBookmark({
          id: `b${offset + i}`,
          created_at: `2026-01-01T00:00:${String(offset + i).padStart(2, "0")}Z`,
        }),
      );

    test("fetch loads just the first page and flags that more may exist", async () => {
      const query = listQuery(page(50));
      from.mockReturnValue({ select: () => query });

      const store = useBookmarksStore();
      await store.fetch();

      expect(query.limit).toHaveBeenCalledWith(50);
      expect(store.bookmarks).toHaveLength(50);
      expect(store.hasMore).toBe(true);
    });

    test("fetch with a short first page reports no more pages", async () => {
      from.mockReturnValue({ select: () => listQuery(page(12)) });

      const store = useBookmarksStore();
      await store.fetch();

      expect(store.hasMore).toBe(false);
    });

    test("loadMore appends the next page keyed off the oldest loaded (created_at, id)", async () => {
      const first = listQuery(page(50));
      const second = listQuery(page(3, 50));
      from.mockReturnValueOnce({ select: () => first }).mockReturnValueOnce({
        select: () => second,
      });

      const store = useBookmarksStore();
      await store.fetch();
      await store.loadMore();

      expect(second.or).toHaveBeenCalledWith(afterCursor("2026-01-01T00:00:49Z", "b49"));
      expect(second.order.mock.calls).toEqual([
        ["created_at", { ascending: false }],
        ["id", { ascending: false }],
      ]);
      expect(store.bookmarks).toHaveLength(53);
      expect(store.hasMore).toBe(false);
    });

    test("a page boundary inside a batch stamped with one instant pages on by id", async () => {
      const sameInstant = "2026-03-01T00:00:00.123456+00:00";
      const batch = Array.from({ length: 50 }, (_, i) =>
        makeBookmark({ id: `id-${String(99 - i).padStart(2, "0")}`, created_at: sameInstant }),
      );
      const second = listQuery([makeBookmark({ id: "id-49", created_at: sameInstant })]);
      from
        .mockReturnValueOnce({ select: () => listQuery(batch) })
        .mockReturnValueOnce({ select: () => second });

      const store = useBookmarksStore();
      await store.fetch();
      await store.loadMore();

      expect(second.or).toHaveBeenCalledWith(afterCursor(sameInstant, "id-50"));
      expect(store.bookmarks.at(-1)?.id).toBe("id-49");
    });

    test("loadMore is a no-op when a search is active", async () => {
      from.mockReturnValue({ select: () => listQuery(page(50)) });
      const store = useBookmarksStore();
      store.setSearchQuery("vue");
      await store.fetch();
      from.mockClear();

      await store.loadMore();

      expect(from).not.toHaveBeenCalled();
    });

    /** A list query whose response the test resolves by hand. */
    function deferredListQuery() {
      const query = listQuery();
      let resolve!: (rows: unknown) => void;
      query.result.mockReturnValue(
        new Promise((r) => {
          resolve = (rows) => r({ data: rows, error: null });
        }),
      );
      return Object.assign(query, { resolve: (rows: unknown) => resolve(rows) });
    }

    test("a loadMore that resolves after a search does not leak unfiltered rows into the results", async () => {
      from.mockReturnValueOnce({ select: () => listQuery(page(50)) });
      const store = useBookmarksStore();
      await store.fetch();

      const more = deferredListQuery();
      from.mockReturnValueOnce({ select: () => more });
      const pendingMore = store.loadMore();

      const hits = [makeBookmark({ id: "hit", created_at: "2026-02-01T00:00:00Z" })];
      from.mockReturnValueOnce({ select: () => listQuery(hits) });
      store.setSearchQuery("vue");
      await store.fetch();

      more.resolve(page(50, 50));
      await pendingMore;

      expect(store.bookmarks.map((b) => b.id)).toEqual(["hit"]);
      expect(store.hasMore).toBe(false);
    });

    test("a slower, superseded fetch does not overwrite the newer result", async () => {
      const store = useBookmarksStore();

      const searchQuery = deferredListQuery();
      from.mockReturnValueOnce({ select: () => searchQuery });
      store.setSearchQuery("vue");
      const searchFetch = store.fetch();

      from.mockReturnValueOnce({ select: () => listQuery(page(50)) });
      store.setSearchQuery("");
      await store.fetch();

      searchQuery.resolve([makeBookmark({ id: "stale-hit" })]);
      await searchFetch;

      expect(store.bookmarks).toHaveLength(50);
      expect(store.bookmarks.some((b) => b.id === "stale-hit")).toBe(false);
      expect(store.hasMore).toBe(true);
      expect(store.loading).toBe(false);
    });

    test("search results never replace the offline list", async () => {
      from.mockReturnValue({ select: () => listQuery([makeBookmark({ id: "hit" })]) });
      const store = useBookmarksStore();
      store.setSearchQuery("vue");
      await store.fetch();
      store.subscribeToChanges();
      emitRealtime({ eventType: "UPDATE", new: makeBookmark({ id: "hit", title: "Renamed" }) });

      expect(replaceBookmarksList).not.toHaveBeenCalled();
    });

    test("a row added by fetchOne does not become the paging cursor", async () => {
      from.mockReturnValueOnce({ select: () => listQuery(page(50)) });
      const store = useBookmarksStore();
      await store.fetch();

      const old = makeBookmark({ id: "old", created_at: "2020-01-01T00:00:00Z" });
      const single = vi.fn().mockResolvedValue({ data: old, error: null });
      from.mockReturnValueOnce({ select: () => ({ eq: () => ({ single }) }) });
      await store.fetchOne("old");

      const more = listQuery(page(3, 50));
      from.mockReturnValueOnce({ select: () => more });
      await store.loadMore();

      expect(more.or).toHaveBeenCalledWith(afterCursor("2026-01-01T00:00:49Z", "b49"));
    });

    test("a search loads the whole result set unpaged", async () => {
      const query = listQuery(page(50));
      from.mockReturnValue({ select: () => query });

      const store = useBookmarksStore();
      store.setSearchQuery("vue");
      await store.fetch();

      expect(query.limit).not.toHaveBeenCalled();
      expect(store.hasMore).toBe(false);
    });
  });

  test("fetchOne requests the full row including article bodies", async () => {
    const row = makeBookmark({ id: "solo" });
    const single = vi.fn().mockResolvedValue({ data: row, error: null });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    from.mockReturnValue({ select });

    const store = useBookmarksStore();
    await store.fetchOne("solo");

    const columns = (select.mock.calls[0] as unknown as [string])[0].split(/,\s*/);
    expect(columns).toEqual(
      expect.arrayContaining(["content_md", "translated_content_md", "tags(id"]),
    );
    // Named columns, not *: the generated tsvector (as large as the body)
    // would otherwise land in memory and in the offline copy.
    expect(columns).not.toContain("*");
    expect(columns).not.toContain("search_vector");
    expect(columns).not.toContain("user_id");
  });

  test("a realtime UPDATE merges over the existing row, keeping an already-loaded body", async () => {
    const seedRows = [makeBookmark({ id: "1", status: "pending", content_md: "loaded body" })];
    from.mockReturnValue({
      select: () => listQuery(seedRows),
    });

    const store = useBookmarksStore();
    await store.fetch();
    store.subscribeToChanges();

    emitRealtime({
      eventType: "UPDATE",
      new: { id: "1", status: "ready", title: "Now ready" },
    });

    expect(store.bookmarks[0]?.status).toBe("ready");
    expect(store.bookmarks[0]?.title).toBe("Now ready");
    expect(store.bookmarks[0]?.content_md).toBe("loaded body");
  });

  test("a Realtime UPDATE keeps the local updated_at so the next delta sync refetches the row", async () => {
    const seedRows = [makeBookmark({ id: "1", updated_at: "2026-10-01T00:00:00Z", tags: [] })];
    from.mockReturnValue({ select: () => listQuery(seedRows) });

    const store = useBookmarksStore();
    await store.fetch();
    store.subscribeToChanges();

    // A tag attached on another device bumps updated_at; the payload has no tags.
    emitRealtime({
      eventType: "UPDATE",
      new: { id: "1", title: "Tagged elsewhere", updated_at: "2026-10-02T00:00:00Z" },
    });

    expect(store.bookmarks[0]?.title).toBe("Tagged elsewhere");
    expect(store.bookmarks[0]?.updated_at).toBe("2026-10-01T00:00:00Z");
  });

  describe("persisting Realtime UPDATEs", () => {
    // What the publication sends: the whole row minus the body columns, and
    // never the tags join.
    function payloadRow(overrides: Partial<Bookmark>) {
      const {
        content_md: _body,
        translated_content_md: _translation,
        tags: _tags,
        ...row
      } = makeBookmark({ id: "1", progress: 0.1, ...overrides });
      return row;
    }

    async function seeded() {
      const seedRows = [makeBookmark({ id: "1", progress: 0.1 })];
      from.mockReturnValue({ select: () => listQuery(seedRows) });
      const store = useBookmarksStore();
      await store.fetch();
      store.subscribeToChanges();
      replaceBookmarksList.mockClear();
      return store;
    }

    test("an echo that only moves reading progress updates the row but isn't persisted", async () => {
      const store = await seeded();

      emitRealtime({
        eventType: "UPDATE",
        new: payloadRow({ progress: 0.5, updated_at: "2026-10-02T00:00:00Z" }),
      });

      expect(store.bookmarks[0]?.progress).toBe(0.5);
      expect(replaceBookmarksList).not.toHaveBeenCalled();
    });

    test("an UPDATE that changes anything else is persisted", async () => {
      await seeded();

      emitRealtime({
        eventType: "UPDATE",
        new: payloadRow({ progress: 0.5, read_at: "2026-10-02T00:00:00Z" }),
      });

      expect(replaceBookmarksList).toHaveBeenCalledOnce();
    });

    test("an UPDATE for a row that isn't loaded isn't persisted", async () => {
      await seeded();

      emitRealtime({ eventType: "UPDATE", new: { id: "elsewhere", title: "Not here" } });

      expect(replaceBookmarksList).not.toHaveBeenCalled();
    });
  });

  test("visibleBookmarks shows non-archived rows on the 'all' filter", async () => {
    const rows = [
      makeBookmark({ id: "1", archived: false }),
      makeBookmark({ id: "2", archived: true }),
    ];
    from.mockReturnValue({
      select: () => listQuery(rows),
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
      select: () => listQuery(rows),
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
      select: () => listQuery(rows),
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
      select: () => listQuery(rows),
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
      select: () => listQuery(rows),
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
      select: () => listQuery(rows),
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
    authState.userId = null;

    const store = useBookmarksStore();
    const result = await store.add("https://arc90.com/new");

    expect(result.error).toBeTruthy();
    expect(from).not.toHaveBeenCalled();
    expect(store.bookmarks).toHaveLength(0);
  });

  test("add returns an error for an unparseable URL", async () => {
    const store = useBookmarksStore();
    const result = await store.add("not a url");

    expect(result.error).toBeTruthy();
    expect(from).not.toHaveBeenCalled();
  });

  test("add rejects a javascript: URL without touching the network", async () => {
    const store = useBookmarksStore();
    const result = await store.add("javascript:alert(document.domain)");

    expect(result.error).toBeTruthy();
    expect(from).not.toHaveBeenCalled();
    expect(store.bookmarks).toEqual([]);
  });

  test("add reports a duplicate with the existing row and skips inserting when the URL is already loaded", async () => {
    const rows = [
      makeBookmark({
        id: "1",
        url: "https://arc90.com/x",
        title: "Already here",
        created_at: "2026-02-03T00:00:00Z",
      }),
    ];
    from.mockReturnValue({
      select: () => listQuery(rows),
    });

    const store = useBookmarksStore();
    await store.fetch();
    from.mockClear();

    const result = await store.add("https://arc90.com/x");

    expect(result).toEqual({
      error: null,
      duplicate: true,
      existingId: "1",
      existingTitle: "Already here",
      existingSavedAt: "2026-02-03T00:00:00Z",
    });
    expect(from).not.toHaveBeenCalled();
  });

  test("add passes an optional title through to the insert", async () => {
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
      select: () => listQuery([original]),
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

  test("fetchOne falls back to offlineDb when network fails and bookmark is not in store", async () => {
    const single = vi.fn().mockRejectedValue(new Error("NetworkError: Failed to fetch"));
    from.mockReturnValue({ select: () => ({ eq: () => ({ single }) }) });

    getBookmarksList.mockResolvedValue([
      makeBookmark({ id: "offline-1", title: "Offline Title", content_md: undefined }),
    ]);
    getArticle.mockResolvedValue({
      id: "offline-1",
      content_md: "Cached offline content",
      translated_content_md: null,
      images: [],
      cachedAt: "2026-01-01T00:00:00Z",
    });

    const store = useBookmarksStore();
    const result = await store.fetchOne("offline-1");

    expect(result).not.toBeNull();
    expect(result?.title).toBe("Offline Title");
    expect(result?.content_md).toBe("Cached offline content");
    expect(store.bookmarks.find((b) => b.id === "offline-1")?.content_md).toBe(
      "Cached offline content",
    );
  });

  test("fetchOne hydrates cached article body when row is already in store without body and network fails", async () => {
    const single = vi.fn().mockRejectedValue(new Error("NetworkError: Failed to fetch"));
    from.mockReturnValue({ select: () => ({ eq: () => ({ single }) }) });

    const store = useBookmarksStore();
    const listRow = makeBookmark({
      id: "offline-2",
      title: "Already In Store",
      content_md: undefined,
    });
    store.bookmarks = [listRow];

    getArticle.mockResolvedValue({
      id: "offline-2",
      content_md: "Hydrated offline markdown",
      translated_content_md: null,
      images: [],
      cachedAt: "2026-01-01T00:00:00Z",
    });

    const result = await store.fetchOne("offline-2");

    expect(result).not.toBeNull();
    expect(result?.content_md).toBe("Hydrated offline markdown");
    expect(store.bookmarks[0]?.content_md).toBe("Hydrated offline markdown");
  });

  test("fetch persists list metadata without article content to the offline store on success", async () => {
    const rows = [makeBookmark({ id: "1", content_md: "full text" })];
    from.mockReturnValue({
      select: () => listQuery(rows),
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
      select: () => listQuery(rows),
    });
    replaceBookmarksList.mockRejectedValue(new Error("private browsing: indexedDB disabled"));

    const store = useBookmarksStore();
    await store.fetch();

    expect(store.bookmarks).toHaveLength(1);
    expect(store.bookmarks[0]?.id).toBe("1");
  });

  test("fetch falls back to the offline cache when the network request fails", async () => {
    const query = listQuery();
    query.result.mockRejectedValue(new Error("offline"));
    from.mockReturnValue({ select: () => query });
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
    getAllArticles.mockResolvedValue([
      { id: "1", content_md: "cached body", images: [], cachedAt: "2026-01-01T00:00:00Z" },
    ]);

    const store = useBookmarksStore();
    await store.fetch();

    expect(store.bookmarks).toHaveLength(1);
    expect(store.bookmarks[0]?.title).toBe("Cached title");
    expect(store.bookmarks[0]?.content_md).toBe("cached body");
    expect(replaceBookmarksList).not.toHaveBeenCalled();
    // getAllArticles() already returned every downloaded copy — no per-row re-read.
    expect(getArticle).not.toHaveBeenCalled();
  });

  test("fetch falls back to the offline cache when supabase returns an error object without throwing", async () => {
    from.mockReturnValue({ select: () => listQuery(null, { message: "fetch failed" }) });
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

  test("fetch discovers downloaded articles from getAllArticles even when getBookmarksList is empty", async () => {
    from.mockReturnValue({ select: () => listQuery(null, { message: "fetch failed" }) });
    getBookmarksList.mockResolvedValue([]);
    getAllArticles.mockResolvedValue([
      {
        id: "offline-dl-1",
        content_md: "offline content",
        images: [],
        cachedAt: "2026-01-01T00:00:00Z",
        bookmark: makeBookmark({ id: "offline-dl-1", title: "Downloaded Bookmark" }),
      },
    ]);

    const store = useBookmarksStore();
    await store.fetch();

    expect(store.bookmarks).toHaveLength(1);
    expect(store.bookmarks[0]?.id).toBe("offline-dl-1");
    expect(store.bookmarks[0]?.title).toBe("Downloaded Bookmark");
    expect(store.bookmarks[0]?.content_md).toBe("offline content");
  });

  test("fetch falls back to offline cache immediately when navigator.onLine is false without calling supabase", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    getAllArticles.mockResolvedValue([
      {
        id: "dl-1",
        content_md: "dl",
        images: [],
        cachedAt: "2026-01-01T00:00:00Z",
        bookmark: makeBookmark({ id: "dl-1", title: "Offline Instant" }),
      },
    ]);

    const store = useBookmarksStore();
    await store.fetch();

    expect(from).not.toHaveBeenCalled();
    expect(store.bookmarks).toHaveLength(1);
    expect(store.bookmarks[0]?.title).toBe("Offline Instant");
    vi.unstubAllGlobals();
  });

  test("persistOfflineList does not wipe offline bookmarks when fetched bookmarks list is empty", async () => {
    from.mockReturnValue({ select: () => listQuery([]) });

    const store = useBookmarksStore();
    await store.fetch();

    expect(replaceBookmarksList).not.toHaveBeenCalled();
  });

  test("fetchOne offline fallback uses metadata attached to cached article when not in store or bookmarksList", async () => {
    const single = vi.fn().mockRejectedValue(new Error("offline"));
    from.mockReturnValue({ select: () => ({ eq: () => ({ single }) }) });
    getBookmarksList.mockResolvedValue([]);
    getArticle.mockResolvedValue({
      id: "dl-2",
      content_md: "cached md",
      images: [],
      cachedAt: "2026-01-01T00:00:00Z",
      bookmark: makeBookmark({ id: "dl-2", title: "Direct Cached Metadata" }),
    });

    const store = useBookmarksStore();
    const result = await store.fetchOne("dl-2");

    expect(result).not.toBeNull();
    expect(result?.title).toBe("Direct Cached Metadata");
    expect(result?.content_md).toBe("cached md");
  });

  test("archive evicts the bookmark from the offline article cache", async () => {
    const rows = [makeBookmark({ id: "1", archived: false })];
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    from.mockReturnValue({
      select: () => listQuery(rows),
      update,
    });

    const store = useBookmarksStore();
    await store.fetch();
    await store.archive("1");

    expect(removeCachedBookmark).toHaveBeenCalledWith("1");
  });

  test("addNote inserts a ready note for the signed-in user and prepends it locally", async () => {
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
        word_count: 1,
        reading_time: 1,
        user_id: "user-1",
      }),
    );
    expect(result.error).toBeNull();
    expect(store.bookmarks[0]?.id).toBe("note-1");
  });

  test("addNote returns an error for blank text without touching the network", async () => {
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

    expect(result.error).toBe("File exceeds the 500KB limit for this file type.");
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

    expect(result.error).toBe("File exceeds the 20MB limit for PDFs.");
    expect(invoke).not.toHaveBeenCalled();
  });

  test("setViewMode persists the toggle and updates local state", async () => {
    const rows = [
      makeBookmark({ id: "1", type: "pdf", pdf_path: "user-1/a.pdf", pdf_parsed: true }),
    ];
    from.mockReturnValue({
      select: () => listQuery(rows),
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
      select: () => listQuery(rows),
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
      select: () => listQuery(rows),
    });
    invoke.mockResolvedValue({
      data: { translated_text: "Hello", translated_lang: "EN" },
      error: null,
    });

    const store = useBookmarksStore();
    await store.fetch();
    const result = await store.translateBookmark("1", "Bonjour", "EN");

    // The function loads the article text itself; the body is never sent.
    expect(invoke).toHaveBeenCalledWith("translate", {
      body: { bookmark_id: "1", target_lang: "EN" },
    });
    expect(result).toEqual({ translatedText: "Hello", error: null });
    expect(store.bookmarks[0]?.translated_content_md).toBe("Hello");
    expect(store.bookmarks[0]?.translated_lang).toBe("EN");
  });

  describe("keeping the offline copy current", () => {
    test("updateContent refreshes the offline copy with the edited body", async () => {
      from.mockReturnValue({
        select: () => listQuery([makeBookmark({ id: "1", content_md: "old" })]),
        update: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      });
      const store = useBookmarksStore();
      await store.fetch();

      await store.updateContent("1", {
        title: "T",
        content_md: "new body",
        word_count: 2,
        reading_time: 1,
      });

      expect(refreshCached).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1", content_md: "new body" }),
      );
    });

    test("a successful translation refreshes the offline copy", async () => {
      from.mockReturnValue({
        select: () => listQuery([makeBookmark({ id: "1", content_md: "Hola" })]),
      });
      invoke.mockResolvedValue({
        data: { translated_text: "Hi", translated_lang: "EN" },
        error: null,
      });
      const store = useBookmarksStore();
      await store.fetch();

      await store.translateBookmark("1", "Hola", "EN");

      expect(refreshCached).toHaveBeenCalledWith(
        expect.objectContaining({ id: "1", translated_content_md: "Hi" }),
      );
    });

    test("offline, a cached translation is restored with the article", async () => {
      from.mockReturnValue({ select: () => listQuery(null, { message: "Failed to fetch" }) });
      getBookmarksList.mockResolvedValue([
        { ...makeBookmark({ id: "1" }), content_md: undefined, translated_content_md: undefined },
      ]);
      getAllArticles.mockResolvedValue([
        { id: "1", content_md: "Hola", translated_content_md: "Hi", images: [], cachedAt: "t" },
      ]);
      const store = useBookmarksStore();

      await store.fetch();

      expect(store.bookmarks[0]?.content_md).toBe("Hola");
      expect(store.bookmarks[0]?.translated_content_md).toBe("Hi");
    });
  });

  test("translateBookmark discards a translation of text that was edited while it was in flight", async () => {
    const rows = [makeBookmark({ id: "1", content_md: "Bonjour" })];
    const eqUpdate = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq: eqUpdate }));
    from.mockReturnValue({ select: () => listQuery(rows), update });

    let respond!: (value: unknown) => void;
    invoke.mockReturnValue(new Promise((r) => (respond = r)));

    const store = useBookmarksStore();
    await store.fetch();
    const pending = store.translateBookmark("1", "Bonjour", "EN");

    // The user saves an edit before DeepL answers.
    store.bookmarks[0].content_md = "Bonjour, édité";
    store.bookmarks[0].translated_content_md = null;
    respond({ data: { translated_text: "Hello", translated_lang: "EN" }, error: null });
    const result = await pending;

    expect(result.error).toMatch(/changed/i);
    expect(store.bookmarks[0]?.translated_content_md).toBeNull();
    // The edge function already persisted the stale translation — clear it.
    expect(update).toHaveBeenCalledWith({ translated_content_md: null, translated_lang: null });
    expect(eqUpdate).toHaveBeenCalledWith("id", "1");
  });

  test("translateBookmark propagates an error from the edge function without touching local state", async () => {
    const rows = [makeBookmark({ id: "1", content_md: "Bonjour" })];
    from.mockReturnValue({
      select: () => listQuery(rows),
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
      select: () => listQuery(rows),
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
      select: () => listQuery(rows),
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
      select: () => listQuery(rows),
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
      select: () => listQuery(rows),
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
      select: () => listQuery(rows),
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

  test("updateContent saves the images' original URLs, never the offline copy's blob: URLs", async () => {
    const rows = [makeBookmark({ id: "1", content_md: "![a](blob:https://app/1)" })];
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn((_fields: Record<string, unknown>) => ({ eq }));
    from.mockReturnValue({ select: () => listQuery(rows), update });
    dehydrateContent.mockImplementationOnce((content: string) =>
      content.replace("blob:https://app/1", "https://cdn/a.png"),
    );

    const store = useBookmarksStore();
    await store.fetch();
    await store.updateContent("1", {
      title: "T",
      content_md: "![a](blob:https://app/1) edited",
      word_count: 1,
      reading_time: 1,
    });

    expect(update.mock.calls[0]?.[0]).toMatchObject({
      content_md: "![a](https://cdn/a.png) edited",
    });
    expect(store.bookmarks[0]?.content_md).toBe("![a](https://cdn/a.png) edited");
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
      select: () => listQuery(rows),
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
    const eqUrl = vi.fn(() => ({ maybeSingle }));
    const eqUser = vi.fn(() => ({ eq: eqUrl }));
    const lookupSelect = vi.fn(() => ({ eq: eqUser }));
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
    // URLs are unique per user, so the lookup is scoped to the signed-in user.
    expect(eqUser).toHaveBeenCalledWith("user_id", "user-1");
    expect(eqUrl).toHaveBeenCalledWith("url_normalized", "https://arc90.com/new");
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
      return { select: () => listQuery(rows) };
    });

    const store = useBookmarksStore();
    await store.fetch();
    await store.addTag("1", "vue");

    // Tags are per user: the owner is in the row and the conflict target.
    expect(tagUpsert).toHaveBeenCalledWith(
      { name: "vue", user_id: "user-1" },
      { onConflict: "user_id,name", ignoreDuplicates: false },
    );
    expect(joinUpsert).toHaveBeenCalledWith(
      { bookmark_id: "1", tag_id: "tag-1" },
      { onConflict: "bookmark_id,tag_id" },
    );
    expect(store.bookmarks[0]?.tags).toEqual([tag]);
  });

  test("addTag signed out reports an error without writing", async () => {
    authState.userId = null;

    const store = useBookmarksStore();
    const result = await store.addTag("1", "vue");

    expect(result.error).toBeTruthy();
    expect(from).not.toHaveBeenCalled();
  });

  test("removeTag unlinks the tag and updates local state", async () => {
    const tag = { id: "tag-1", name: "vue", color: "#888888" };
    const rows = [makeBookmark({ id: "1", tags: [tag] })];
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const del = vi.fn(() => ({ eq: eq1 }));

    from.mockImplementation((table: string) => {
      if (table === "bookmark_tags") return { delete: del };
      return { select: () => listQuery(rows) };
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
      select: () => listQuery(rows),
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

  describe("remove cleans up the bookmark's Storage objects", () => {
    async function removeLoaded(row: Bookmark, deleteError: unknown = null) {
      from.mockReturnValue({
        select: () => listQuery([row]),
        delete: () => ({ eq: vi.fn().mockResolvedValue({ error: deleteError }) }),
      });
      const store = useBookmarksStore();
      await store.fetch();
      return store.remove(row.id);
    }

    test("the original PDF and a thumbnail in our assets bucket are removed", async () => {
      storageRemove.mockResolvedValue({ error: null });
      await removeLoaded(
        makeBookmark({
          id: "1",
          pdf_path: "user-1/abc.pdf",
          thumbnail_url:
            "https://proj.supabase.co/storage/v1/object/public/bookmark-assets/youtube/f00.jpeg",
        }),
      );

      expect(storageRemoveFrom).toHaveBeenCalledWith("bookmark-pdfs", ["user-1/abc.pdf"]);
      expect(storageRemoveFrom).toHaveBeenCalledWith("bookmark-assets", ["youtube/f00.jpeg"]);
    });

    test("a hot-linked thumbnail is not ours to remove", async () => {
      await removeLoaded(makeBookmark({ id: "1", thumbnail_url: "https://cdn.example.com/t.png" }));

      expect(storageRemoveFrom).not.toHaveBeenCalled();
    });

    test("a failing Storage removal doesn't fail the delete", async () => {
      storageRemove.mockRejectedValueOnce(new Error("network"));
      const result = await removeLoaded(makeBookmark({ id: "1", pdf_path: "user-1/abc.pdf" }));

      expect(result.error).toBeNull();
    });

    test("nothing is removed from Storage when the row delete fails", async () => {
      await removeLoaded(makeBookmark({ id: "1", pdf_path: "user-1/abc.pdf" }), {
        message: "network down",
      });

      expect(storageRemoveFrom).not.toHaveBeenCalled();
    });
  });

  describe("failed writes leave local state as the server has it", () => {
    const failing = () => vi.fn().mockResolvedValue({ error: { message: "network down" } });

    test("markRead reports the error and keeps read_at", async () => {
      const rows = [makeBookmark({ id: "1", read_at: null })];
      from.mockReturnValue({ select: () => listQuery(rows), update: () => ({ eq: failing() }) });

      const store = useBookmarksStore();
      await store.fetch();
      const result = await store.markRead("1");

      expect(result.error).toBeTruthy();
      expect(store.bookmarks[0]?.read_at).toBeNull();
    });

    test("archive reports the error, keeps the row unarchived and its offline copy", async () => {
      const rows = [makeBookmark({ id: "1", archived: false })];
      from.mockReturnValue({ select: () => listQuery(rows), update: () => ({ eq: failing() }) });

      const store = useBookmarksStore();
      await store.fetch();
      const result = await store.archive("1");

      expect(result.error).toBeTruthy();
      expect(store.bookmarks[0]?.archived).toBe(false);
      expect(removeCachedBookmark).not.toHaveBeenCalled();
    });

    test("updateContent reports the error and keeps the old body", async () => {
      const rows = [makeBookmark({ id: "1", title: "Old", content_md: "old" })];
      from.mockReturnValue({ select: () => listQuery(rows), update: () => ({ eq: failing() }) });

      const store = useBookmarksStore();
      await store.fetch();
      const result = await store.updateContent("1", {
        title: "New",
        content_md: "new",
        word_count: 1,
        reading_time: 1,
      });

      expect(result.error).toBeTruthy();
      expect(store.bookmarks[0]).toMatchObject({ title: "Old", content_md: "old" });
    });

    test("remove puts the row back where it was and keeps offline data", async () => {
      const rows = [
        makeBookmark({ id: "1" }),
        makeBookmark({ id: "2" }),
        makeBookmark({ id: "3" }),
      ];
      from.mockReturnValue({ select: () => listQuery(rows), delete: () => ({ eq: failing() }) });

      const store = useBookmarksStore();
      await store.fetch();
      const result = await store.remove("2");

      expect(result.error).toBeTruthy();
      expect(store.bookmarks.map((b) => b.id)).toEqual(["1", "2", "3"]);
      expect(deleteBookmarkMeta).not.toHaveBeenCalled();
      expect(removeCachedBookmark).not.toHaveBeenCalled();
    });
  });

  describe("delta sync", () => {
    const row = (id: string, created: string, updated: string, extra: Partial<Bookmark> = {}) =>
      makeBookmark({
        id,
        created_at: `2026-10-${created}T00:00:00Z`,
        updated_at: `2026-10-${updated}T00:00:00Z`,
        ...extra,
      });

    /** Route `from(table)` to a per-table query stub. */
    function tables(bookmarks: ReturnType<typeof listQuery>, deletions = listQuery([])) {
      from.mockImplementation((table: string) => ({
        select: () => (table === "bookmark_deletions" ? deletions : bookmarks),
      }));
    }

    const firstPage = () => [row("b", "05", "06"), row("a", "01", "09")];

    test("a first-page fetch persists the list with its sync state", async () => {
      tables(listQuery(firstPage()));
      const store = useBookmarksStore();
      await store.fetch();

      expect(replaceBookmarksList).toHaveBeenLastCalledWith(expect.any(Array), {
        watermark: "2026-10-09T00:00:00Z",
        cursor: { created_at: "2026-10-01T00:00:00Z", id: "a" },
        hasMore: false,
      });
    });

    test("a repeat fetch asks only for what changed since the watermark", async () => {
      tables(listQuery(firstPage()));
      const store = useBookmarksStore();
      await store.fetch();

      const delta = listQuery([row("c", "10", "10"), row("b", "05", "10", { title: "Renamed" })]);
      const deletions = listQuery([{ bookmark_id: "a", deleted_at: "2026-10-11T00:00:00Z" }]);
      tables(delta, deletions);
      await store.fetch();

      // Watermark minus the 5-minute overlap.
      expect(delta.gte).toHaveBeenCalledWith("updated_at", "2026-10-08T23:55:00.000Z");
      expect(deletions.gte).toHaveBeenCalledWith("deleted_at", "2026-10-08T23:55:00.000Z");
      expect(delta.limit).not.toHaveBeenCalledWith(50);
      expect(store.bookmarks.map((b) => [b.id, b.title])).toEqual([
        ["c", "Title"],
        ["b", "Renamed"],
      ]);
      expect(replaceBookmarksList).toHaveBeenLastCalledWith(
        expect.any(Array),
        expect.objectContaining({ watermark: "2026-10-11T00:00:00Z" }),
      );
    });

    test("tombstoned rows lose their downloaded copy and offline metadata", async () => {
      tables(listQuery(firstPage()));
      const store = useBookmarksStore();
      await store.fetch();

      tables(listQuery([]), listQuery([{ bookmark_id: "a", deleted_at: "2026-10-11T00:00:00Z" }]));
      await store.fetch();

      expect(removeCachedBookmark).toHaveBeenCalledWith("a");
      expect(deleteBookmarkMeta).toHaveBeenCalledWith("a");
    });

    test("a delta too large to apply still evicts the deleted rows it fetched", async () => {
      tables(listQuery(firstPage()));
      const store = useBookmarksStore();
      await store.fetch();

      const many = Array.from({ length: 201 }, (_, i) => row(`n${i}`, "10", "10"));
      tables(
        listQuery(many),
        listQuery([{ bookmark_id: "a", deleted_at: "2026-10-11T00:00:00Z" }]),
      );
      await store.fetch();

      // The fresh first page moves the watermark past this tombstone, so this
      // is the only chance to drop the deleted row's downloaded copy.
      expect(removeCachedBookmark).toHaveBeenCalledWith("a");
      expect(deleteBookmarkMeta).toHaveBeenCalledWith("a");
    });

    test("a row re-sent unchanged by the overlap keeps the body the reader loaded", async () => {
      tables(listQuery(firstPage()));
      const store = useBookmarksStore();
      await store.fetch();
      store.bookmarks[1].content_md = "loaded body";

      const { content_md: _body, ...listRow } = row("a", "01", "09");
      tables(listQuery([listRow]));
      await store.fetch();

      expect(store.bookmarks.find((b) => b.id === "a")?.content_md).toBe("loaded body");
    });

    test("a changed row older than the paged window is left for loadMore", async () => {
      const page = Array.from({ length: 50 }, (_, i) =>
        row(`p${i}`, String(30 - Math.floor(i / 5)).padStart(2, "0"), "20"),
      );
      tables(listQuery(page));
      const store = useBookmarksStore();
      await store.fetch();
      expect(store.hasMore).toBe(true);

      tables(listQuery([row("old", "01", "21")]));
      await store.fetch();

      expect(store.bookmarks.some((b) => b.id === "old")).toBe(false);
    });

    test("a changed row stamped with the cursor's instant is in the window only if it sorts before the cursor", async () => {
      const page = Array.from({ length: 50 }, (_, i) =>
        row(
          `p${String(i).padStart(2, "0")}`,
          String(30 - Math.floor(i / 5)).padStart(2, "0"),
          "20",
        ),
      );
      tables(listQuery(page));
      const store = useBookmarksStore();
      await store.fetch();
      // Cursor: (2026-10-21, "p49").

      tables(listQuery([row("q-after", "21", "22"), row("a-past", "21", "22")]));
      await store.fetch();

      expect(store.bookmarks.some((b) => b.id === "q-after")).toBe(true);
      expect(store.bookmarks.some((b) => b.id === "a-past")).toBe(false);
    });

    test("rows within one millisecond keep the server's microsecond order", async () => {
      tables(listQuery([row("x", "01", "01")]));
      const store = useBookmarksStore();
      await store.fetch();

      tables(
        listQuery([
          makeBookmark({
            id: "z-earlier",
            created_at: "2026-10-05T00:00:00.123400+00:00",
            updated_at: "2026-10-09T00:00:00Z",
          }),
          makeBookmark({
            id: "a-later",
            created_at: "2026-10-05T00:00:00.1239+00:00",
            updated_at: "2026-10-09T00:00:00Z",
          }),
        ]),
      );
      await store.fetch();

      expect(store.bookmarks.map((b) => b.id)).toEqual(["a-later", "z-earlier", "x"]);
    });

    test("a cold start shows the persisted window, then patches it by delta", async () => {
      getSyncState.mockResolvedValue({
        watermark: "2026-10-09T00:00:00Z",
        cursor: { created_at: "2026-10-05T00:00:00Z", id: "a" },
        hasMore: true,
      });
      getBookmarksList.mockResolvedValue([
        row("b", "06", "06"),
        row("a", "05", "05"),
        // A downloaded article's metadata, older than the window.
        row("stale", "01", "01"),
      ]);
      const delta = listQuery([row("b", "06", "10", { title: "Fresh" })]);
      tables(delta);

      const store = useBookmarksStore();
      await store.fetch();

      expect(delta.gte).toHaveBeenCalledWith("updated_at", "2026-10-08T23:55:00.000Z");
      expect(store.bookmarks.map((b) => [b.id, b.title])).toEqual([
        ["b", "Fresh"],
        ["a", "Title"],
      ]);
      expect(store.hasMore).toBe(true);
    });

    test("a cold start online leaves downloaded bodies out of the list, so the reader fetches the real one", async () => {
      getSyncState.mockResolvedValue({
        watermark: "2026-10-09T00:00:00Z",
        cursor: null,
        hasMore: false,
      });
      const meta = row("a", "05", "05");
      getBookmarksList.mockResolvedValue([meta]);
      getAllArticles.mockResolvedValue([
        {
          id: "a",
          bookmark: meta,
          content_md: "![x](blob:http://app/1)",
          translated_content_md: "![x](blob:http://app/2)",
          images: [],
          cachedAt: "2026-10-05T00:00:00Z",
        },
      ]);
      tables(listQuery([]));

      const store = useBookmarksStore();
      await store.fetch();

      expect(store.bookmarks.map((b) => b.id)).toEqual(["a"]);
      expect(store.bookmarks[0]?.content_md).toBeUndefined();
      expect(store.bookmarks[0]?.translated_content_md).toBeUndefined();
      // Metadata only: the downloaded articles (and their image blobs) stay closed.
      expect(getAllArticles).not.toHaveBeenCalled();
      expect(getArticle).not.toHaveBeenCalled();
    });

    test("a delta too large to replay falls back to a fresh first page", async () => {
      getSyncState.mockResolvedValue({
        watermark: "2026-10-09T00:00:00Z",
        cursor: null,
        hasMore: false,
      });
      const huge = Array.from({ length: 201 }, (_, i) => row(`d${i}`, "10", "10"));
      const fresh = listQuery([row("new", "10", "10")]);
      let call = 0;
      from.mockImplementation((table: string) => ({
        select: () =>
          table === "bookmark_deletions" ? listQuery([]) : call++ === 0 ? listQuery(huge) : fresh,
      }));

      const store = useBookmarksStore();
      await store.fetch();

      expect(fresh.limit).toHaveBeenCalledWith(50);
      expect(store.bookmarks.map((b) => b.id)).toEqual(["new"]);
    });

    test("a failed delta falls back to the offline copy", async () => {
      tables(listQuery(firstPage()));
      const store = useBookmarksStore();
      await store.fetch();

      getBookmarksList.mockResolvedValue([row("cached", "01", "01")]);
      tables(listQuery(null, { message: "network" }));
      await store.fetch();

      expect(store.bookmarks.map((b) => b.id)).toEqual(["cached"]);
    });
  });

  describe("realtime", () => {
    function seedStore(rows: Bookmark[]) {
      from.mockReturnValue({
        select: () => listQuery(rows),
      });
    }

    test("subscribeToChanges opens one postgres_changes channel and is idempotent", async () => {
      seedStore([]);
      const store = useBookmarksStore();

      store.subscribeToChanges();
      store.subscribeToChanges();

      expect(channel).toHaveBeenCalledTimes(1);
      expect(channel).toHaveBeenCalledWith("bookmarks-changes");
      expect(onSpy).toHaveBeenCalledWith(
        "postgres_changes",
        expect.objectContaining({ event: "*", schema: "public", table: "bookmarks" }),
        expect.any(Function),
      );
    });

    test("an INSERT event prepends the new row", async () => {
      seedStore([makeBookmark({ id: "1" })]);
      const store = useBookmarksStore();
      await store.fetch();
      store.subscribeToChanges();

      emitRealtime({ eventType: "INSERT", new: makeBookmark({ id: "2", title: "Fresh" }) });

      expect(store.bookmarks.map((b) => b.id)).toEqual(["2", "1"]);
    });

    test("an INSERT event is ignored while a search is active", async () => {
      from.mockReturnValue({ select: () => listQuery([makeBookmark({ id: "1" })]) });
      const store = useBookmarksStore();
      store.setSearchQuery("hello");
      await store.fetch();
      store.subscribeToChanges();

      emitRealtime({ eventType: "INSERT", new: makeBookmark({ id: "2" }) });

      expect(store.bookmarks.map((b) => b.id)).toEqual(["1"]);
    });

    test("a duplicate INSERT (echo of a local add) is not added twice", async () => {
      seedStore([makeBookmark({ id: "1" })]);
      const store = useBookmarksStore();
      await store.fetch();
      store.subscribeToChanges();

      emitRealtime({ eventType: "INSERT", new: makeBookmark({ id: "1" }) });

      expect(store.bookmarks).toHaveLength(1);
    });

    describe("an add whose Realtime INSERT arrives before its own response", () => {
      const created = makeBookmark({
        id: "new",
        url: "https://arc90.com/new",
        title: "From the response",
        tags: [{ id: "t1", name: "tag", color: "#000000" }],
      });
      // The echo lands while the request is still awaiting its response.
      const realtimeFirst = () =>
        emitRealtime({ eventType: "INSERT", new: { ...created, title: "From Realtime" } });
      const insertResponds = () => {
        const single = vi.fn(async () => {
          realtimeFirst();
          return { data: created, error: null };
        });
        from.mockReturnValue({ insert: () => ({ select: () => ({ single }) }) });
      };
      const edgeFunctionResponds = () =>
        invoke.mockImplementation(async () => {
          realtimeFirst();
          return { data: { bookmark: created }, error: null };
        });

      type Store = ReturnType<typeof useBookmarksStore>;
      test.each<[string, (store: Store) => Promise<unknown>]>([
        [
          "add",
          (store) => {
            insertResponds();
            return store.add("https://arc90.com/new");
          },
        ],
        [
          "addNote",
          (store) => {
            insertResponds();
            return store.addNote("a note");
          },
        ],
        [
          "addSnippet",
          (store) => {
            edgeFunctionResponds();
            return store.addSnippet("<b>x</b>", "x");
          },
        ],
        [
          "addFile",
          (store) => {
            edgeFunctionResponds();
            return store.addFile(new File(["# hi"], "notes.md", { type: "text/markdown" }));
          },
        ],
        [
          "addPdf",
          (store) => {
            edgeFunctionResponds();
            return store.addPdf(new File(["%PDF-1.4"], "a.pdf", { type: "application/pdf" }));
          },
        ],
      ])("%s lists the row once, as the response has it", async (_name, run) => {
        const store = useBookmarksStore();
        store.bookmarks = [makeBookmark({ id: "old" })];
        store.subscribeToChanges();

        await run(store);

        expect(store.bookmarks.map((b) => b.id)).toEqual(["new", "old"]);
        expect(store.bookmarks[0]?.title).toBe("From the response");
        expect(store.bookmarks[0]?.tags).toHaveLength(1);
      });
    });

    test("a DELETE event drops the row and its offline metadata", async () => {
      seedStore([makeBookmark({ id: "1" }), makeBookmark({ id: "2" })]);
      const store = useBookmarksStore();
      await store.fetch();
      store.subscribeToChanges();

      emitRealtime({ eventType: "DELETE", old: { id: "1" } });

      expect(store.bookmarks.map((b) => b.id)).toEqual(["2"]);
    });

    test("unsubscribeFromChanges removes the channel and lets a later subscribe reopen it", async () => {
      seedStore([]);
      const store = useBookmarksStore();

      store.subscribeToChanges();
      store.unsubscribeFromChanges();
      store.subscribeToChanges();

      expect(removeChannel).toHaveBeenCalledTimes(1);
      expect(channel).toHaveBeenCalledTimes(2);
    });
  });

  describe("client-side filtering", () => {
    test("visibleBookmarks keeps only rows carrying every active tag (match-all)", async () => {
      const vue = { id: "t-vue", name: "vue", color: "#111" };
      const perf = { id: "t-perf", name: "perf", color: "#222" };
      from.mockReturnValue({
        select: () =>
          listQuery([
            makeBookmark({ id: "1", tags: [vue, perf] }),
            makeBookmark({ id: "2", tags: [vue] }),
            makeBookmark({ id: "3", tags: [perf] }),
          ]),
      });

      const store = useBookmarksStore();
      await store.fetch();
      store.setActiveTagIds(["t-vue", "t-perf"]);

      expect(store.visibleBookmarks.map((b) => b.id)).toEqual(["1"]);
    });

    test("setActiveTagIds does not issue a query", async () => {
      from.mockReturnValue({
        select: () => listQuery([]),
      });
      const store = useBookmarksStore();
      await store.fetch();
      from.mockClear();

      store.setActiveTagIds(["t-vue"]);

      expect(from).not.toHaveBeenCalled();
    });

    test("setSearchQuery does not issue a query on its own", async () => {
      const store = useBookmarksStore();
      store.setSearchQuery("hello");
      expect(from).not.toHaveBeenCalled();
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

    test("a failed write is sent again", async () => {
      const eqUpdate = vi
        .fn()
        .mockResolvedValueOnce({ error: { message: "Failed to fetch" } })
        .mockResolvedValue({ error: null });
      const update = vi.fn(() => ({ eq: eqUpdate }));
      from.mockReturnValue({ update });
      const store = useBookmarksStore();
      store.bookmarks = [makeBookmark({ id: "bm-1", progress: 0 })];

      expect((await store.updateProgress("bm-1", 0.3)).error).not.toBeNull();
      expect(await store.sendUnsentProgress()).toBe(true);

      expect(update).toHaveBeenLastCalledWith({ progress: 0.3 });
      // Sent: nothing left to resend.
      expect(await store.sendUnsentProgress()).toBe(true);
      expect(update).toHaveBeenCalledTimes(2);
    });

    test("an older write failing after a newer one landed resends the newer value", async () => {
      const older = deferred<{ error: unknown }>();
      const eqUpdate = vi
        .fn()
        .mockReturnValueOnce(older.promise)
        .mockResolvedValue({ error: null });
      const update = vi.fn(() => ({ eq: eqUpdate }));
      from.mockReturnValue({ update });
      const store = useBookmarksStore();
      store.bookmarks = [makeBookmark({ id: "bm-1", progress: 0 })];

      const first = store.updateProgress("bm-1", 0.3);
      await store.updateProgress("bm-1", 0.5);
      older.resolve({ error: { message: "Failed to fetch" } });
      await first;
      await store.sendUnsentProgress();

      expect(update).toHaveBeenLastCalledWith({ progress: 0.5 });
    });

    test("an older write landing after a newer one failed keeps the newer value unsent", async () => {
      const older = deferred<{ error: unknown }>();
      const eqUpdate = vi
        .fn()
        .mockReturnValueOnce(older.promise)
        .mockResolvedValueOnce({ error: { message: "Failed to fetch" } })
        .mockResolvedValue({ error: null });
      const update = vi.fn((_fields: { progress: number }) => ({ eq: eqUpdate }));
      from.mockReturnValue({ update });
      const store = useBookmarksStore();
      store.bookmarks = [makeBookmark({ id: "bm-1", progress: 0 })];

      const first = store.updateProgress("bm-1", 0.3);
      await store.updateProgress("bm-1", 0.5);
      older.resolve({ error: null });
      await first;
      await store.sendUnsentProgress();

      expect(update).toHaveBeenCalledTimes(3);
      expect(update).toHaveBeenLastCalledWith({ progress: 0.5 });
    });

    test("sendUnsentProgress waits for a write still in flight", async () => {
      const inFlight = deferred<{ error: unknown }>();
      from.mockReturnValue({ update: vi.fn(() => ({ eq: vi.fn(() => inFlight.promise) })) });
      const store = useBookmarksStore();
      store.bookmarks = [makeBookmark({ id: "bm-1", progress: 0 })];

      void store.updateProgress("bm-1", 0.7);
      let settled = false;
      const sent = store.sendUnsentProgress().then((ok) => {
        settled = true;
        return ok;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(settled).toBe(false);

      inFlight.resolve({ error: null });
      expect(await sent).toBe(true);
    });

    test("a write that keeps failing stays unsent", async () => {
      const eqUpdate = vi.fn().mockResolvedValue({ error: { message: "Failed to fetch" } });
      from.mockReturnValue({ update: vi.fn(() => ({ eq: eqUpdate })) });
      const store = useBookmarksStore();

      await store.updateProgress("gone", 0.5);

      expect(await store.sendUnsentProgress()).toBe(false);
      expect(eqUpdate).toHaveBeenCalledTimes(2);
    });

    test("fetch sends unsent progress before the delta sync", async () => {
      const store = useBookmarksStore();
      store.bookmarks = [makeBookmark({ id: "bm-1", progress: 0 })];
      const calls: string[] = [];
      const failing = vi.fn().mockResolvedValue({ error: { message: "Failed to fetch" } });
      from.mockReturnValue({ update: vi.fn(() => ({ eq: failing })) });
      await store.updateProgress("bm-1", 0.6);

      const update = vi.fn(() => ({
        eq: vi.fn(async () => {
          calls.push("update");
          return { error: null };
        }),
      }));
      const page = listQuery([]);
      from.mockReturnValue({
        update,
        select: () => {
          calls.push("select");
          return page;
        },
      });
      await store.fetch();

      expect(update).toHaveBeenCalledWith({ progress: 0.6 });
      expect(calls[0]).toBe("update");
    });
  });

  /** A promise plus the functions that settle it, for holding a call in flight. */
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  const syncState = (overrides: Record<string, unknown> = {}) => ({
    watermark: "2026-10-09T00:00:00Z",
    cursor: null,
    hasMore: false,
    ...overrides,
  });

  const dated = (id: string, created: string, updated = created, extra: Partial<Bookmark> = {}) =>
    makeBookmark({
      id,
      created_at: `2026-10-${created}T00:00:00Z`,
      updated_at: `2026-10-${updated}T00:00:00Z`,
      ...extra,
    });

  /** Route `from(table)` to a per-table list query stub. */
  function routeTables(bookmarks: ReturnType<typeof listQuery>, deletions = listQuery([])) {
    from.mockImplementation((table: string) => ({
      select: () => (table === "bookmark_deletions" ? deletions : bookmarks),
    }));
  }

  describe("list edge cases", () => {
    test("a list response with no data and no error shows an empty list", async () => {
      from.mockReturnValue({ select: () => listQuery(null) });

      const store = useBookmarksStore();
      await store.fetch();

      expect(store.bookmarks).toEqual([]);
      expect(store.hasMore).toBe(false);
    });

    test("rows without an embedded tags array never match a tag filter and add no tags", async () => {
      const tag = { id: "t1", name: "vue", color: "#888888" };
      const store = useBookmarksStore();
      store.bookmarks = [
        makeBookmark({ id: "untagged", tags: null as unknown as Bookmark["tags"] }),
        makeBookmark({ id: "tagged", tags: [tag] }),
      ];
      store.setActiveTagIds(["t1"]);

      expect(store.visibleBookmarks.map((b) => b.id)).toEqual(["tagged"]);
      expect(store.allTags).toEqual([tag]);
    });

    test("loadMore with more pages flagged but no cursor stops paging without a query", async () => {
      getSyncState.mockResolvedValue(syncState({ hasMore: true }));
      routeTables(listQuery([]));
      const store = useBookmarksStore();
      await store.fetch();
      expect(store.hasMore).toBe(true);
      from.mockClear();

      await store.loadMore();

      expect(store.hasMore).toBe(false);
      expect(from).not.toHaveBeenCalled();
    });

    test("an empty older page ends paging and keeps the existing cursor", async () => {
      const firstPage = Array.from({ length: 50 }, (_, i) =>
        dated(`p${String(i).padStart(2, "0")}`, String(30 - Math.floor(i / 5)).padStart(2, "0")),
      );
      from.mockReturnValueOnce({ select: () => listQuery(firstPage) });
      const store = useBookmarksStore();
      await store.fetch();

      from.mockReturnValueOnce({ select: () => listQuery([]) });
      await store.loadMore();

      expect(store.hasMore).toBe(false);
      expect(store.bookmarks).toHaveLength(50);
      expect(replaceBookmarksList).toHaveBeenLastCalledWith(expect.any(Array), {
        watermark: "2026-10-30T00:00:00Z",
        cursor: { created_at: "2026-10-21T00:00:00Z", id: "p49" },
        hasMore: false,
      });
    });
  });

  describe("watermark", () => {
    test("loadMore never moves it: a newer row on an older page can't hide a missed page-1 change", async () => {
      // Page 1 synced at 10-09; the next page holds a row edited on 10-20.
      const firstPage = Array.from({ length: 50 }, (_, i) =>
        dated(
          `p${String(i).padStart(2, "0")}`,
          String(30 - Math.floor(i / 5)).padStart(2, "0"),
          "09",
        ),
      );
      from.mockReturnValueOnce({ select: () => listQuery(firstPage) });
      const store = useBookmarksStore();
      await store.fetch();

      from.mockReturnValueOnce({ select: () => listQuery([dated("old", "02", "20")]) });
      await store.loadMore();

      expect(replaceBookmarksList).toHaveBeenLastCalledWith(
        expect.any(Array),
        expect.objectContaining({ watermark: "2026-10-09T00:00:00Z" }),
      );

      // The next delta still asks from 10-09 (minus the overlap), so a page-1
      // change missed over Realtime on 10-15 is fetched.
      const delta = listQuery([]);
      routeTables(delta);
      await store.fetch();
      expect(delta.gte).toHaveBeenCalledWith("updated_at", "2026-10-08T23:55:00.000Z");
    });
  });

  describe("offline snapshot", () => {
    test("both offline stores failing leaves an empty list rather than an error", async () => {
      vi.stubGlobal("navigator", { onLine: false });
      getBookmarksList.mockRejectedValue(new Error("IndexedDB blocked"));
      getAllArticles.mockRejectedValue(new Error("IndexedDB blocked"));

      const store = useBookmarksStore();
      await store.fetch();

      expect(store.bookmarks).toEqual([]);
      expect(store.loading).toBe(false);
      vi.unstubAllGlobals();
    });

    test("rows are newest first, with rows missing a created_at last", async () => {
      vi.stubGlobal("navigator", { onLine: false });
      getBookmarksList.mockResolvedValue([
        dated("older", "01"),
        makeBookmark({ id: "undated", created_at: "" }),
        dated("newer", "05"),
      ]);

      const store = useBookmarksStore();
      await store.fetch();

      expect(store.bookmarks.map((b) => b.id)).toEqual(["newer", "older", "undated"]);
      vi.unstubAllGlobals();
    });

    test("an offline search matches the title or excerpt, case-insensitively", async () => {
      vi.stubGlobal("navigator", { onLine: false });
      getBookmarksList.mockResolvedValue([
        dated("by-title", "03", "03", { title: "Vue tips" }),
        dated("by-excerpt", "02", "02", { title: null, excerpt: "All about vue" }),
        dated("unrelated", "01", "01", { title: "Rust", excerpt: null }),
      ]);

      const store = useBookmarksStore();
      store.setSearchQuery("VUE");
      await store.fetch();

      expect(store.bookmarks.map((b) => b.id)).toEqual(["by-title", "by-excerpt"]);
      vi.unstubAllGlobals();
    });

    test("an INSERT while the unfiltered offline snapshot is up is shown", async () => {
      vi.stubGlobal("navigator", { onLine: false });
      getBookmarksList.mockResolvedValue([dated("cached", "01")]);
      const store = useBookmarksStore();
      await store.fetch();
      vi.unstubAllGlobals();
      store.subscribeToChanges();

      emitRealtime({ eventType: "INSERT", new: dated("live", "05") });

      expect(store.bookmarks.map((b) => b.id)).toEqual(["live", "cached"]);
    });
  });

  describe("results that arrive after reset", () => {
    test("a persisted snapshot loaded after reset is not shown", async () => {
      getSyncState.mockResolvedValue(syncState());
      const snapshot = deferred<Bookmark[]>();
      getBookmarksList.mockReturnValue(snapshot.promise);

      const store = useBookmarksStore();
      const pending = store.fetch();
      await vi.waitFor(() => expect(getBookmarksList).toHaveBeenCalled());
      store.reset();
      snapshot.resolve([dated("stale", "01")]);
      await pending;

      expect(store.bookmarks).toEqual([]);
      expect(from).not.toHaveBeenCalled();
    });

    test("a delta that lands after reset is discarded", async () => {
      routeTables(listQuery([dated("a", "01")]));
      const store = useBookmarksStore();
      await store.fetch();

      const delta = listQuery();
      const response = deferred<unknown>();
      delta.result.mockReturnValue(response.promise);
      routeTables(delta);
      const pending = store.fetch();
      await vi.waitFor(() => expect(delta.result).toHaveBeenCalled());
      store.reset();
      response.resolve({ data: [dated("b", "05")], error: null });
      await pending;

      expect(store.bookmarks).toEqual([]);
      expect(replaceBookmarksList).toHaveBeenCalledTimes(1);
    });

    test("a delta whose tombstone cleanup finishes after reset is discarded", async () => {
      routeTables(listQuery([dated("a", "01"), dated("b", "02")]));
      const store = useBookmarksStore();
      await store.fetch();

      const cleanup = deferred<void>();
      removeCachedBookmark.mockReturnValue(cleanup.promise);
      routeTables(
        listQuery([]),
        listQuery([{ bookmark_id: "a", deleted_at: "2026-10-10T00:00:00Z" }]),
      );
      const pending = store.fetch();
      await vi.waitFor(() => expect(removeCachedBookmark).toHaveBeenCalledWith("a"));
      store.reset();
      cleanup.resolve();
      await pending;

      expect(store.bookmarks).toEqual([]);
      expect(replaceBookmarksList).toHaveBeenCalledTimes(1);
    });

    test("a list request failing after reset doesn't put up the offline snapshot", async () => {
      const query = listQuery();
      const response = deferred<unknown>();
      query.result.mockReturnValue(response.promise);
      from.mockReturnValue({ select: () => query });
      getBookmarksList.mockResolvedValue([dated("cached", "01")]);

      const store = useBookmarksStore();
      const pending = store.fetch();
      await vi.waitFor(() => expect(query.result).toHaveBeenCalled());
      store.reset();
      response.reject(new Error("Failed to fetch"));
      await pending;

      expect(store.bookmarks).toEqual([]);
      expect(getBookmarksList).not.toHaveBeenCalled();
    });

    test("an offline snapshot loaded after reset is not shown", async () => {
      vi.stubGlobal("navigator", { onLine: false });
      const list = deferred<Bookmark[]>();
      getBookmarksList.mockReturnValue(list.promise);

      const store = useBookmarksStore();
      const pending = store.fetch();
      await vi.waitFor(() => expect(getBookmarksList).toHaveBeenCalled());
      store.reset();
      list.resolve([dated("cached", "01")]);
      await pending;

      expect(store.bookmarks).toEqual([]);
      vi.unstubAllGlobals();
    });
  });

  describe("delta sync edge cases", () => {
    async function synced() {
      routeTables(listQuery([dated("b", "05"), dated("a", "01")]));
      const store = useBookmarksStore();
      await store.fetch();
      return store;
    }

    test("a 401 on the deletions query ends the login", async () => {
      const store = await synced();
      const deletions = listQuery();
      deletions.result.mockResolvedValue({ data: null, error: { message: "JWT" }, status: 401 });
      routeTables(listQuery([]), deletions);
      authState.sessionExpired.mockImplementation(() => {
        authState.userId = null;
      });

      await store.fetch();

      expect(authState.sessionExpired).toHaveBeenCalledOnce();
      expect(getBookmarksList).not.toHaveBeenCalled();
    });

    test("a failed deletions query falls back to the offline copy", async () => {
      const store = await synced();
      getBookmarksList.mockResolvedValue([dated("cached", "01")]);
      routeTables(listQuery([]), listQuery(null, { message: "network" }));

      await store.fetch();

      expect(store.bookmarks.map((b) => b.id)).toEqual(["cached"]);
    });

    test("empty delta responses leave the list as it was", async () => {
      const store = await synced();
      routeTables(listQuery(null), listQuery(null));

      await store.fetch();

      expect(store.bookmarks.map((b) => b.id)).toEqual(["b", "a"]);
    });

    test("a row changed and then deleted in the same delta is not shown", async () => {
      const store = await synced();
      routeTables(
        listQuery([dated("c", "07")]),
        listQuery([{ bookmark_id: "c", deleted_at: "2026-10-08T00:00:00Z" }]),
      );

      await store.fetch();

      expect(store.bookmarks.map((b) => b.id)).toEqual(["b", "a"]);
    });

    test("a tombstone is applied even when clearing its offline data fails", async () => {
      const store = await synced();
      deleteBookmarkMeta.mockRejectedValue(new Error("IndexedDB blocked"));
      routeTables(
        listQuery([]),
        listQuery([{ bookmark_id: "a", deleted_at: "2026-10-10T00:00:00Z" }]),
      );

      await store.fetch();

      expect(store.bookmarks.map((b) => b.id)).toEqual(["b"]);
    });

    test("an unreadable sync state loads a fresh first page", async () => {
      getSyncState.mockRejectedValue(new Error("IndexedDB blocked"));
      const page = listQuery([dated("fresh", "05")]);
      routeTables(page);

      const store = useBookmarksStore();
      await store.fetch();

      expect(page.limit).toHaveBeenCalledWith(50);
      expect(store.bookmarks.map((b) => b.id)).toEqual(["fresh"]);
    });

    test("an unreadable persisted list on a cold start is rebuilt from the delta", async () => {
      getSyncState.mockResolvedValue(syncState());
      getBookmarksList.mockRejectedValue(new Error("IndexedDB blocked"));
      const delta = listQuery([dated("b", "06", "10")]);
      routeTables(delta);

      const store = useBookmarksStore();
      await store.fetch();

      expect(delta.gte).toHaveBeenCalledWith("updated_at", "2026-10-08T23:55:00.000Z");
      expect(store.bookmarks.map((b) => b.id)).toEqual(["b"]);
    });
  });

  describe("realtime edge cases", () => {
    test("an INSERT without embedded tags gets an empty tag list", async () => {
      from.mockReturnValue({ select: () => listQuery([]) });
      const store = useBookmarksStore();
      await store.fetch();
      store.subscribeToChanges();

      emitRealtime({ eventType: "INSERT", new: { ...dated("n", "05"), tags: undefined } });

      expect(store.bookmarks[0]?.tags).toEqual([]);
    });

    test("a DELETE without an id in its payload changes nothing", async () => {
      from.mockReturnValue({ select: () => listQuery([dated("a", "01")]) });
      const store = useBookmarksStore();
      await store.fetch();
      store.subscribeToChanges();

      emitRealtime({ eventType: "DELETE", old: {} });

      expect(store.bookmarks.map((b) => b.id)).toEqual(["a"]);
    });

    test("unsubscribing without a subscription is a no-op", () => {
      const store = useBookmarksStore();
      store.unsubscribeFromChanges();

      expect(removeChannel).not.toHaveBeenCalled();
    });
  });

  describe("fetchOne fallbacks", () => {
    function failingSingle() {
      from.mockReturnValue({
        select: () => ({
          eq: () => ({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: "down" } }),
          }),
        }),
      });
    }

    test("offline, it reads the downloaded copy without touching the network", async () => {
      vi.stubGlobal("navigator", { onLine: false });
      getArticle.mockResolvedValue({
        id: "dl",
        content_md: "cached body",
        translated_content_md: null,
        images: [],
        cachedAt: "2026-01-01T00:00:00Z",
        bookmark: makeBookmark({ id: "dl", title: "Downloaded" }),
      });

      const store = useBookmarksStore();
      const result = await store.fetchOne("dl");

      expect(from).not.toHaveBeenCalled();
      expect(result?.title).toBe("Downloaded");
      expect(result?.content_md).toBe("cached body");
      vi.unstubAllGlobals();
    });

    test("with nothing readable anywhere it returns null", async () => {
      failingSingle();
      getArticle.mockRejectedValue(new Error("IndexedDB blocked"));
      getBookmarksList.mockRejectedValue(new Error("IndexedDB blocked"));

      const store = useBookmarksStore();
      const result = await store.fetchOne("missing");

      expect(result).toBeNull();
      expect(store.bookmarks).toEqual([]);
    });

    test("listed metadata without a downloaded copy has no body", async () => {
      failingSingle();
      const meta = makeBookmark({ id: "m" }) as Partial<Bookmark>;
      delete meta.content_md;
      delete meta.translated_content_md;
      getBookmarksList.mockResolvedValue([meta]);

      const store = useBookmarksStore();
      const result = await store.fetchOne("m");

      expect(result?.content_md).toBeNull();
      expect(result?.translated_content_md).toBeNull();
    });

    test("a loaded row without a downloaded copy keeps its body and translation", async () => {
      failingSingle();
      const store = useBookmarksStore();
      store.bookmarks = [
        makeBookmark({ id: "m", content_md: "body", translated_content_md: "tr" }),
      ];

      const result = await store.fetchOne("m");

      expect(result?.content_md).toBe("body");
      expect(result?.translated_content_md).toBe("tr");
      expect(store.bookmarks).toHaveLength(1);
    });

    test("a downloaded copy without stored metadata is readable as a placeholder", async () => {
      failingSingle();
      getArticle.mockResolvedValue({
        id: "legacy",
        content_md: "old body",
        translated_content_md: "old translation",
        images: [],
        cachedAt: "2026-01-02T00:00:00Z",
      });

      const store = useBookmarksStore();
      const result = await store.fetchOne("legacy");

      expect(result).toMatchObject({
        id: "legacy",
        title: "Offline Article",
        content_md: "old body",
        translated_content_md: "old translation",
        created_at: "2026-01-02T00:00:00Z",
      });
      expect(store.bookmarks.map((b) => b.id)).toEqual(["legacy"]);
    });
  });

  describe("adding: failures", () => {
    function failingInsert(error: unknown) {
      return {
        insert: () => ({ select: () => ({ single: async () => ({ data: null, error }) }) }),
      };
    }

    test("add reports a non-duplicate insert error", async () => {
      from.mockReturnValue(failingInsert({ code: "42501", message: "permission denied" }));

      const store = useBookmarksStore();
      const result = await store.add("https://arc90.com/new");

      expect(result).toEqual({ error: "permission denied" });
      expect(store.bookmarks).toEqual([]);
    });

    test("add reports the unique violation when the existing row can't be found", async () => {
      from.mockReturnValueOnce(failingInsert({ code: "23505", message: "duplicate key" }));
      from.mockReturnValueOnce({
        select: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        }),
      });

      const store = useBookmarksStore();
      const result = await store.add("https://arc90.com/new");

      expect(result).toEqual({ error: "duplicate key" });
    });

    test("addNote signed out reports an error without writing", async () => {
      authState.userId = null;

      const store = useBookmarksStore();
      const result = await store.addNote("hello");

      expect(result.error).toBeTruthy();
      expect(from).not.toHaveBeenCalled();
    });

    test("addNote reports an insert error", async () => {
      from.mockReturnValue(failingInsert({ message: "insert failed" }));

      const store = useBookmarksStore();
      const result = await store.addNote("hello");

      expect(result).toEqual({ error: "insert failed" });
      expect(store.bookmarks).toEqual([]);
    });

    test("addFile rejects a .docx over 5MB without calling the edge function", async () => {
      const store = useBookmarksStore();
      const big = new Uint8Array(5 * 1024 * 1024 + 1);
      const result = await store.addFile(new File([big], "big.docx"));

      expect(result.error).toBe("File exceeds the 5MB limit for this file type.");
      expect(invoke).not.toHaveBeenCalled();
    });

    test("addFile reports an edge function error", async () => {
      invoke.mockResolvedValue({ data: null, error: { message: "conversion failed" } });

      const store = useBookmarksStore();
      const result = await store.addFile(new File(["x"], "a.docx"));

      expect(result).toEqual({ error: "conversion failed" });
      expect(store.bookmarks).toEqual([]);
    });

    test("addPdf rejects a file that isn't a PDF", async () => {
      const store = useBookmarksStore();
      const result = await store.addPdf(new File(["x"], "notes.md"));

      expect(result.error).toBe("Unsupported file type. Use .pdf.");
      expect(invoke).not.toHaveBeenCalled();
    });

    test("addPdf reports an edge function error", async () => {
      invoke.mockResolvedValue({ data: null, error: { message: "extraction failed" } });

      const store = useBookmarksStore();
      const result = await store.addPdf(new File(["%PDF"], "a.pdf"));

      expect(result).toEqual({ error: "extraction failed" });
      expect(store.bookmarks).toEqual([]);
    });
  });

  describe("more failed writes leave local state as the server has it", () => {
    const failingEq = () => vi.fn().mockResolvedValue({ error: { message: "network down" } });

    test("setViewMode reports the error and keeps the mode", async () => {
      from.mockReturnValue({ update: () => ({ eq: failingEq() }) });
      const store = useBookmarksStore();
      store.bookmarks = [makeBookmark({ id: "1", view_mode: "markdown" })];

      const result = await store.setViewMode("1", "original");

      expect(result.error).toBeTruthy();
      expect(store.bookmarks[0]?.view_mode).toBe("markdown");
    });

    test("setPublic reports the error and keeps is_public", async () => {
      from.mockReturnValue({ update: () => ({ eq: failingEq() }) });
      const store = useBookmarksStore();
      store.bookmarks = [makeBookmark({ id: "1", is_public: false })];

      const result = await store.setPublic("1", true);

      expect(result.error).toBeTruthy();
      expect(store.bookmarks[0]?.is_public).toBe(false);
    });

    test("markUnread reports the error and keeps read_at", async () => {
      from.mockReturnValue({ update: () => ({ eq: failingEq() }) });
      const store = useBookmarksStore();
      store.bookmarks = [makeBookmark({ id: "1", read_at: "2026-01-01T00:00:00Z" })];

      const result = await store.markUnread("1");

      expect(result.error).toBeTruthy();
      expect(store.bookmarks[0]?.read_at).toBe("2026-01-01T00:00:00Z");
    });

    test("removeTag reports the error and keeps the tag", async () => {
      const tag = { id: "t1", name: "vue", color: "#888888" };
      from.mockReturnValue({ delete: () => ({ eq: () => ({ eq: failingEq() }) }) });
      const store = useBookmarksStore();
      store.bookmarks = [makeBookmark({ id: "1", tags: [tag] })];

      const result = await store.removeTag("1", "t1");

      expect(result.error).toBeTruthy();
      expect(store.bookmarks[0]?.tags).toEqual([tag]);
    });

    test("trashOriginalPdf clears the row before deleting the file, and stops if that fails", async () => {
      const order: string[] = [];
      from.mockReturnValue({
        update: () => ({
          eq: vi.fn(async () => {
            order.push("update");
            return { error: { message: "network down" } };
          }),
        }),
      });
      storageRemove.mockImplementation(async () => {
        order.push("remove");
        return { error: null };
      });
      const store = useBookmarksStore();
      store.bookmarks = [
        makeBookmark({ id: "1", pdf_path: "user-1/a.pdf", view_mode: "original" }),
      ];

      const result = await store.trashOriginalPdf("1");

      expect(result.error).toBeTruthy();
      expect(order).toEqual(["update"]);
      // The row still points at a file that still exists.
      expect(store.bookmarks[0]?.pdf_path).toBe("user-1/a.pdf");
      expect(store.bookmarks[0]?.view_mode).toBe("original");
    });

    test("trashOriginalPdf leaves a file it couldn't delete to the storage sweep", async () => {
      from.mockReturnValue({
        update: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      });
      storageRemove.mockResolvedValue({ error: { message: "storage down" } });
      const store = useBookmarksStore();
      store.bookmarks = [makeBookmark({ id: "1", pdf_path: "user-1/a.pdf" })];

      const result = await store.trashOriginalPdf("1");

      // Nothing points at the file any more; the sweep removes orphans.
      expect(result).toEqual({ error: null });
      expect(store.bookmarks[0]?.pdf_path).toBeNull();
    });
  });

  describe("writes to a bookmark that isn't loaded here", () => {
    // The reader can open a row that never entered this session's list
    // (e.g. via a direct link); the write still goes to the server.
    const okUpdate = () => {
      const eq = vi.fn().mockResolvedValue({ error: null });
      from.mockReturnValue({
        update: vi.fn(() => ({ eq })),
        delete: () => ({ eq: () => ({ eq }) }),
      });
      return eq;
    };

    test.each([
      ["setViewMode", (s: ReturnType<typeof useBookmarksStore>) => s.setViewMode("x", "original")],
      ["setPublic", (s: ReturnType<typeof useBookmarksStore>) => s.setPublic("x", true)],
      ["markRead", (s: ReturnType<typeof useBookmarksStore>) => s.markRead("x")],
      ["markUnread", (s: ReturnType<typeof useBookmarksStore>) => s.markUnread("x")],
      ["archive", (s: ReturnType<typeof useBookmarksStore>) => s.archive("x")],
      ["removeTag", (s: ReturnType<typeof useBookmarksStore>) => s.removeTag("x", "t1")],
      [
        "updateContent",
        (s: ReturnType<typeof useBookmarksStore>) =>
          s.updateContent("x", { title: "T", content_md: "b", word_count: 1, reading_time: 1 }),
      ],
    ])("%s is sent to the server and reports success", async (_name, write) => {
      const eq = okUpdate();
      const store = useBookmarksStore();

      const result = await write(store);

      expect(result.error).toBeNull();
      expect(eq).toHaveBeenCalled();
      expect(store.bookmarks).toEqual([]);
      expect(refreshCached).not.toHaveBeenCalled();
    });

    test("updateProgress is sent to the server", async () => {
      const eq = okUpdate();
      const store = useBookmarksStore();

      await store.updateProgress("x", 0.5);

      expect(eq).toHaveBeenCalledWith("id", "x");
      expect(store.bookmarks).toEqual([]);
    });

    test("translateBookmark returns the translation without caching it locally", async () => {
      invoke.mockResolvedValue({
        data: { translated_text: "Hallo", translated_lang: "DE" },
        error: null,
      });
      const store = useBookmarksStore();

      const result = await store.translateBookmark("x", "Hello", "DE");

      expect(result).toEqual({ translatedText: "Hallo", error: null });
      expect(refreshCached).not.toHaveBeenCalled();
      expect(from).not.toHaveBeenCalled();
    });
  });

  test("refresh reports a failed reset and keeps the row's status", async () => {
    from.mockReturnValue({
      update: () => ({ eq: vi.fn().mockResolvedValue({ error: { message: "down" } }) }),
    });
    const store = useBookmarksStore();
    store.bookmarks = [makeBookmark({ id: "1", status: "failed", error_message: "boom" })];

    const result = await store.refresh("1");

    expect(result.error).toBeTruthy();
    expect(store.bookmarks[0]).toMatchObject({ status: "failed", error_message: "boom" });
  });

  describe("addTag edge cases", () => {
    const tag = { id: "t1", name: "vue", color: "#888888" };

    function tagTables(tagResult: { data: unknown; error: unknown }, joinError: unknown = null) {
      const joinUpsert = vi.fn().mockResolvedValue({ error: joinError });
      from.mockImplementation((table: string) =>
        table === "tags"
          ? { upsert: () => ({ select: () => ({ single: async () => tagResult }) }) }
          : { upsert: joinUpsert },
      );
      return joinUpsert;
    }

    test("a blank name is ignored without writing", async () => {
      const store = useBookmarksStore();
      const result = await store.addTag("1", "   ");

      expect(result.error).toBeNull();
      expect(from).not.toHaveBeenCalled();
    });

    test("a failed tag upsert reports the error and links nothing", async () => {
      const joinUpsert = tagTables({ data: null, error: { message: "denied" } });
      const store = useBookmarksStore();
      store.bookmarks = [makeBookmark({ id: "1", tags: [] })];

      const result = await store.addTag("1", "vue");

      expect(result.error).toBeTruthy();
      expect(joinUpsert).not.toHaveBeenCalled();
      expect(store.bookmarks[0]?.tags).toEqual([]);
    });

    test("a tag upsert returning no row is treated as a failure", async () => {
      const joinUpsert = tagTables({ data: null, error: null });
      const store = useBookmarksStore();

      const result = await store.addTag("1", "vue");

      expect(result.error).toBeTruthy();
      expect(joinUpsert).not.toHaveBeenCalled();
    });

    test("a failed link reports the error and leaves the bookmark's tags alone", async () => {
      tagTables({ data: tag, error: null }, { message: "denied" });
      const store = useBookmarksStore();
      store.bookmarks = [makeBookmark({ id: "1", tags: [] })];

      const result = await store.addTag("1", "vue");

      expect(result.error).toBeTruthy();
      expect(store.bookmarks[0]?.tags).toEqual([]);
    });

    test("a tag the bookmark already carries is not listed twice", async () => {
      tagTables({ data: tag, error: null });
      const store = useBookmarksStore();
      store.bookmarks = [makeBookmark({ id: "1", tags: [tag] })];

      const result = await store.addTag("1", "vue");

      expect(result.error).toBeNull();
      expect(store.bookmarks[0]?.tags).toEqual([tag]);
    });
  });

  describe("best-effort offline cleanup", () => {
    test("archive succeeds even when evicting the offline copy fails", async () => {
      from.mockReturnValue({ update: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) });
      removeCachedBookmark.mockRejectedValue(new Error("IndexedDB blocked"));
      const store = useBookmarksStore();
      store.bookmarks = [makeBookmark({ id: "1" })];

      const result = await store.archive("1");

      expect(result.error).toBeNull();
      expect(store.bookmarks[0]?.archived).toBe(true);
    });

    test("updateContent succeeds even when refreshing the offline copy fails", async () => {
      from.mockReturnValue({ update: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) });
      refreshCached.mockRejectedValue(new Error("IndexedDB blocked"));
      const store = useBookmarksStore();
      store.bookmarks = [makeBookmark({ id: "1", content_md: "old" })];

      const result = await store.updateContent("1", {
        title: "T",
        content_md: "new",
        word_count: 1,
        reading_time: 1,
      });

      expect(result.error).toBeNull();
      expect(store.bookmarks[0]?.content_md).toBe("new");
      expect(refreshCached).toHaveBeenCalled();
    });

    test("remove succeeds even when clearing offline data fails", async () => {
      from.mockReturnValue({ delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) });
      deleteBookmarkMeta.mockRejectedValue(new Error("IndexedDB blocked"));
      removeCachedBookmark.mockRejectedValue(new Error("IndexedDB blocked"));
      const store = useBookmarksStore();
      store.bookmarks = [makeBookmark({ id: "1" })];

      const result = await store.remove("1");

      expect(result.error).toBeNull();
      expect(store.bookmarks).toEqual([]);
    });

    test("a thumbnail URL pointing at the assets bucket root names nothing to remove", async () => {
      from.mockReturnValue({ delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) });
      const store = useBookmarksStore();
      store.bookmarks = [
        makeBookmark({
          id: "1",
          thumbnail_url: "https://proj.supabase.co/storage/v1/object/public/bookmark-assets/?v=1",
        }),
      ];

      await store.remove("1");

      expect(storageRemoveFrom).not.toHaveBeenCalled();
    });

    test("a failed delete of a row that isn't loaded leaves the list empty", async () => {
      from.mockReturnValue({
        delete: () => ({ eq: vi.fn().mockResolvedValue({ error: { message: "down" } }) }),
      });
      const store = useBookmarksStore();

      const result = await store.remove("elsewhere");

      expect(result.error).toBeTruthy();
      expect(store.bookmarks).toEqual([]);
      expect(deleteBookmarkMeta).not.toHaveBeenCalled();
    });

    test("removing a row that isn't loaded still clears its offline data, with no Storage cleanup", async () => {
      from.mockReturnValue({ delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) });
      const store = useBookmarksStore();

      const result = await store.remove("elsewhere");

      expect(result.error).toBeNull();
      expect(deleteBookmarkMeta).toHaveBeenCalledWith("elsewhere");
      expect(removeCachedBookmark).toHaveBeenCalledWith("elsewhere");
      expect(storageRemoveFrom).not.toHaveBeenCalled();
    });
  });
});
