import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Bookmark } from "../lib/supabase";

const { bookmarks, undo, offlineCache } = vi.hoisted(() => ({
  bookmarks: { markRead: vi.fn(), fetchOne: vi.fn() },
  undo: { archive: vi.fn(), unarchive: vi.fn(), remove: vi.fn(), fail: vi.fn() },
  offlineCache: { cacheBookmark: vi.fn(), isCached: vi.fn() },
}));
vi.mock("../stores/bookmarks", () => ({ useBookmarksStore: () => bookmarks }));
vi.mock("../stores/undo", () => ({ useUndoStore: () => undo }));
vi.mock("../stores/offlineCache", () => ({ useOfflineCacheStore: () => offlineCache }));

const { useBulkActions, offersSaveOffline, SAVE_OFFLINE_CONCURRENCY } =
  await import("./useBulkActions");

const FAILED = "Couldn't save the change. Check your connection and try again.";

function row(id: string, extra: Partial<Bookmark> = {}): Bookmark {
  return {
    id,
    archived: false,
    read_at: null,
    content_md: `body ${id}`,
    ...extra,
  } as Bookmark;
}

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("useBulkActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    undo.archive.mockResolvedValue({ error: null });
    undo.unarchive.mockResolvedValue({ error: null });
    bookmarks.markRead.mockResolvedValue({ error: null });
    offlineCache.cacheBookmark.mockResolvedValue(undefined);
    offlineCache.isCached.mockReturnValue(false);
  });

  test("archive goes through the undo store with every id, and reports success", async () => {
    const bulk = useBulkActions();

    expect(await bulk.archive([row("a"), row("b")])).toBe(true);

    expect(undo.archive).toHaveBeenCalledWith("a", "b");
    expect(undo.fail).not.toHaveBeenCalled();
  });

  test("a refused archive shows the error in the toast", async () => {
    undo.archive.mockResolvedValue({ error: FAILED });
    const bulk = useBulkActions();

    expect(await bulk.archive([row("a")])).toBe(false);

    expect(undo.fail).toHaveBeenCalledWith(FAILED);
  });

  test("busy while a write is in flight", async () => {
    let answer: (value: { error: null }) => void = () => {};
    undo.unarchive.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const bulk = useBulkActions();

    const pending = bulk.unarchive([row("a"), row("b")]);
    expect(bulk.busy.value).toBe(true);
    answer({ error: null });

    expect(await pending).toBe(true);
    expect(bulk.busy.value).toBe(false);
    expect(undo.unarchive).toHaveBeenCalledWith("a", "b");
  });

  test("mark read sends only the unread rows", async () => {
    const bulk = useBulkActions();

    await bulk.markRead([row("a"), row("b", { read_at: "2026-11-01T00:00:00Z" }), row("c")]);

    expect(bookmarks.markRead).toHaveBeenCalledWith("a", "c");
  });

  test("a refused mark read shows the error", async () => {
    bookmarks.markRead.mockResolvedValue({ error: FAILED });
    const bulk = useBulkActions();

    expect(await bulk.markRead([row("a")])).toBe(false);
    expect(undo.fail).toHaveBeenCalledWith(FAILED);
  });

  test("delete stages every id through the undo store", () => {
    const bulk = useBulkActions();

    bulk.remove([row("a"), row("b")]);

    expect(undo.remove).toHaveBeenCalledWith("a", "b");
  });

  test("save offline is offered for unread rows without a copy, as on the row", () => {
    expect(offersSaveOffline(row("a"), false)).toBe(true);
    expect(offersSaveOffline(row("a"), true)).toBe(false);
    expect(offersSaveOffline(row("a", { read_at: "2026-11-01T00:00:00Z" }), false)).toBe(false);
    expect(offersSaveOffline(row("a", { archived: true }), false)).toBe(false);
  });

  test("save offline caches each eligible row, loading a body the list doesn't hold", async () => {
    offlineCache.isCached.mockImplementation((id: string) => id === "cached");
    const full = row("b", { content_md: "full body" });
    bookmarks.fetchOne.mockResolvedValue(full);
    const bulk = useBulkActions();

    await bulk.saveOffline([
      row("a"),
      row("b", { content_md: undefined }),
      row("cached"),
      row("read", { read_at: "2026-11-01T00:00:00Z" }),
    ]);

    expect(bookmarks.fetchOne).toHaveBeenCalledTimes(1);
    expect(bookmarks.fetchOne).toHaveBeenCalledWith("b");
    expect(offlineCache.cacheBookmark.mock.calls.map(([b]) => b.id)).toEqual(["a", "b"]);
    expect(offlineCache.cacheBookmark).toHaveBeenCalledWith(full);
    expect(undo.fail).not.toHaveBeenCalled();
  });

  test(`at most ${SAVE_OFFLINE_CONCURRENCY} downloads run at once`, async () => {
    const saves = new Map<string, ReturnType<typeof deferred>>();
    offlineCache.cacheBookmark.mockImplementation((b: Bookmark) => {
      const save = deferred();
      saves.set(b.id, save);
      return save.promise;
    });
    const bulk = useBulkActions();

    const done = bulk.saveOffline(["a", "b", "c", "d", "e"].map((id) => row(id)));
    await vi.waitFor(() => expect(saves.size).toBe(3));
    expect([...saves.keys()]).toEqual(["a", "b", "c"]);

    saves.get("b")!.resolve();
    await vi.waitFor(() => expect(saves.size).toBe(4));
    expect(saves.has("d")).toBe(true);
    for (const id of ["a", "c", "d"]) saves.get(id)!.resolve();
    await vi.waitFor(() => expect(saves.size).toBe(5));
    saves.get("e")!.resolve();
    await done;
  });

  test("rows that couldn't be saved are counted in one error", async () => {
    offlineCache.cacheBookmark.mockImplementation((b: Bookmark) =>
      b.id === "a" ? Promise.reject(new Error("quota")) : Promise.resolve(),
    );
    // No body to save: still processing, or the body couldn't be loaded.
    bookmarks.fetchOne.mockImplementation(async (id: string) =>
      id === "gone" ? null : row(id, { content_md: null }),
    );
    const bulk = useBulkActions();

    await bulk.saveOffline([
      row("a"),
      row("ok"),
      row("gone", { content_md: undefined }),
      row("pending", { content_md: undefined }),
    ]);

    expect(undo.fail).toHaveBeenCalledWith("Couldn't save 3 items for offline reading.");
  });

  test("one row that couldn't be saved is named in the singular", async () => {
    offlineCache.cacheBookmark.mockRejectedValue(new Error("quota"));
    const bulk = useBulkActions();

    await bulk.saveOffline([row("a")]);

    expect(undo.fail).toHaveBeenCalledWith("Couldn't save 1 item for offline reading.");
  });
});
