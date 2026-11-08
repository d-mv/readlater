import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const bookmarks = vi.hoisted(() => ({
  archive: vi.fn(),
  unarchive: vi.fn(),
  remove: vi.fn(),
  undoRemove: vi.fn(),
  commitRemove: vi.fn(),
}));
vi.mock("./bookmarks", () => ({ useBookmarksStore: () => bookmarks }));

const { useUndoStore, UNDO_WINDOW_MS } = await import("./undo");

const FAILED = "Couldn't save the change. Check your connection and try again.";

describe("useUndoStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    bookmarks.archive.mockResolvedValue({ error: null });
    bookmarks.unarchive.mockResolvedValue({ error: null });
    bookmarks.commitRemove.mockResolvedValue({ error: null });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("an archive offers undo for the undo window, then the notice goes", async () => {
    const undo = useUndoStore();

    expect(await undo.archive("1")).toEqual({ error: null });
    expect(bookmarks.archive).toHaveBeenCalledWith("1");
    expect(undo.notice).toEqual({ kind: "archived", ids: ["1"] });

    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1);
    expect(undo.notice).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(undo.notice).toBeNull();
  });

  test("a refused archive shows no notice and reports the error", async () => {
    bookmarks.archive.mockResolvedValue({ error: FAILED });
    const undo = useUndoStore();

    expect(await undo.archive("1")).toEqual({ error: FAILED });
    expect(undo.notice).toBeNull();
  });

  test("undoing an archive unarchives the row", async () => {
    const undo = useUndoStore();
    await undo.archive("1");

    await undo.undo();

    expect(bookmarks.unarchive).toHaveBeenCalledWith("1");
    expect(undo.notice).toBeNull();
  });

  test("a refused unarchive says so", async () => {
    bookmarks.unarchive.mockResolvedValue({ error: FAILED });
    const undo = useUndoStore();
    await undo.archive("1");

    await undo.undo();

    expect(undo.notice).toEqual({ kind: "failed", message: FAILED });
  });

  test("a delete is sent only once the undo window is over", async () => {
    const undo = useUndoStore();
    undo.remove("1");

    expect(bookmarks.remove).toHaveBeenCalledWith("1");
    expect(undo.notice).toEqual({ kind: "deleted", ids: ["1"] });
    // Committing whatever was staged before is a no-op here.
    bookmarks.commitRemove.mockClear();
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1);
    expect(bookmarks.commitRemove).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(bookmarks.commitRemove).toHaveBeenCalledTimes(1);
    expect(undo.notice).toBeNull();
  });

  test("undoing a delete takes it back and nothing is sent", async () => {
    const undo = useUndoStore();
    undo.remove("1");
    bookmarks.commitRemove.mockClear();

    await undo.undo();
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);

    expect(bookmarks.undoRemove).toHaveBeenCalledWith("1");
    expect(bookmarks.commitRemove).not.toHaveBeenCalled();
    expect(undo.notice).toBeNull();
  });

  test("a delete the server refuses says so", async () => {
    bookmarks.commitRemove.mockResolvedValue({ error: FAILED });
    const undo = useUndoStore();
    undo.remove("1");
    bookmarks.commitRemove.mockClear();
    bookmarks.commitRemove.mockResolvedValue({ error: FAILED });

    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);

    expect(undo.notice).toEqual({ kind: "failed", message: FAILED });
  });

  test("a new action commits a delete still waiting, and takes over the notice", async () => {
    const undo = useUndoStore();
    undo.remove("1");
    bookmarks.commitRemove.mockClear();

    await undo.archive("2");

    expect(bookmarks.commitRemove).toHaveBeenCalledTimes(1);
    expect(undo.notice).toEqual({ kind: "archived", ids: ["2"] });
  });

  test("flush sends a waiting delete at once and drops its notice", async () => {
    const undo = useUndoStore();
    undo.remove("1");
    bookmarks.commitRemove.mockClear();

    await undo.flush();

    expect(bookmarks.commitRemove).toHaveBeenCalledTimes(1);
    expect(undo.notice).toBeNull();
  });

  test("flush leaves an archive's undo in place", async () => {
    const undo = useUndoStore();
    await undo.archive("1");

    await undo.flush();

    expect(undo.notice).toEqual({ kind: "archived", ids: ["1"] });
  });

  test("undo with nothing on offer does nothing", async () => {
    const undo = useUndoStore();

    await undo.undo();

    expect(bookmarks.unarchive).not.toHaveBeenCalled();
    expect(bookmarks.undoRemove).not.toHaveBeenCalled();
  });

  test("undo on a failure notice just closes it", async () => {
    bookmarks.unarchive.mockResolvedValue({ error: FAILED });
    const undo = useUndoStore();
    await undo.archive("1");
    await undo.undo();
    bookmarks.unarchive.mockClear();

    await undo.undo();

    expect(undo.notice).toBeNull();
    expect(bookmarks.unarchive).not.toHaveBeenCalled();
  });

  test("reset drops the notice and its timer", async () => {
    const undo = useUndoStore();
    undo.remove("1");
    bookmarks.commitRemove.mockClear();

    undo.reset();
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);

    expect(undo.notice).toBeNull();
    expect(bookmarks.commitRemove).not.toHaveBeenCalled();
  });
  test("several rows are archived as one action, and one undo brings them all back", async () => {
    const undo = useUndoStore();

    expect(await undo.archive("1", "2", "3")).toEqual({ error: null });
    expect(bookmarks.archive).toHaveBeenCalledWith("1", "2", "3");
    expect(undo.notice).toEqual({ kind: "archived", ids: ["1", "2", "3"] });

    await undo.undo();
    expect(bookmarks.unarchive).toHaveBeenCalledWith("1", "2", "3");
  });

  test("several rows are deleted as one action, and one undo brings them all back", async () => {
    const undo = useUndoStore();

    undo.remove("1", "2");
    expect(bookmarks.remove).toHaveBeenCalledWith("1", "2");
    expect(undo.notice).toEqual({ kind: "deleted", ids: ["1", "2"] });

    await undo.undo();
    expect(bookmarks.undoRemove).toHaveBeenCalledWith("1", "2");
  });

  test("an unarchive offers undo, which archives the rows again", async () => {
    const undo = useUndoStore();

    expect(await undo.unarchive("1", "2")).toEqual({ error: null });
    expect(bookmarks.unarchive).toHaveBeenCalledWith("1", "2");
    expect(undo.notice).toEqual({ kind: "unarchived", ids: ["1", "2"] });

    await undo.undo();
    expect(bookmarks.archive).toHaveBeenCalledWith("1", "2");
    expect(undo.notice).toBeNull();
  });

  test("an unarchive commits a delete still waiting", async () => {
    const undo = useUndoStore();
    undo.remove("1");
    bookmarks.commitRemove.mockClear();

    await undo.unarchive("2");

    expect(bookmarks.commitRemove).toHaveBeenCalledTimes(1);
  });

  test("a refused unarchive shows no notice and reports the error", async () => {
    bookmarks.unarchive.mockResolvedValue({ error: FAILED });
    const undo = useUndoStore();

    expect(await undo.unarchive("1")).toEqual({ error: FAILED });
    expect(undo.notice).toBeNull();
  });

  test("a refused re-archive (undoing an unarchive) says so", async () => {
    const undo = useUndoStore();
    await undo.unarchive("1");
    bookmarks.archive.mockResolvedValue({ error: FAILED });

    await undo.undo();

    expect(undo.notice).toEqual({ kind: "failed", message: FAILED });
  });

  test("fail shows a write that didn't happen, for the undo window", () => {
    const undo = useUndoStore();

    undo.fail(FAILED);
    expect(undo.notice).toEqual({ kind: "failed", message: FAILED });

    vi.advanceTimersByTime(UNDO_WINDOW_MS);
    expect(undo.notice).toBeNull();
  });
});
