import { readonly, shallowRef } from "vue";
import type { Bookmark } from "../lib/supabase";
import { useBookmarksStore, type WriteResult } from "../stores/bookmarks";
import { useOfflineCacheStore } from "../stores/offlineCache";
import { useUndoStore } from "../stores/undo";

// Downloads (body + every image) running at once for a bulk Save offline.
export const SAVE_OFFLINE_CONCURRENCY = 3;

// The row's own rule (BookmarkRow.vue): saving is offered for what's still to
// be read and has no offline copy yet.
export function offersSaveOffline(bookmark: Bookmark, isCached: boolean): boolean {
  return !bookmark.archived && bookmark.read_at === null && !isCached;
}

// Runs `task` over `items`, at most `limit` at a time, in order.
async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < items.length) await task(items[next++]!);
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// The reading list's bulk actions on the selected rows. Every server write is
// one request for all of them (the stores send `id=in.(…)`); archive,
// unarchive and delete go through the undo store, so one toast takes the
// whole batch back. A refused write changes nothing locally and its error
// shows in the toast.
export function useBulkActions() {
  const store = useBookmarksStore();
  const undo = useUndoStore();
  const offlineCache = useOfflineCacheStore();
  const busy = shallowRef(false);

  async function write(send: () => Promise<WriteResult>): Promise<boolean> {
    busy.value = true;
    try {
      const { error } = await send();
      if (error) undo.fail(error);
      return error === null;
    } finally {
      busy.value = false;
    }
  }

  const idsOf = (rows: readonly Bookmark[]) => rows.map((b) => b.id);

  function archive(rows: readonly Bookmark[]): Promise<boolean> {
    return write(() => undo.archive(...idsOf(rows)));
  }

  function unarchive(rows: readonly Bookmark[]): Promise<boolean> {
    return write(() => undo.unarchive(...idsOf(rows)));
  }

  // Rows read already keep the read_at they have.
  function markRead(rows: readonly Bookmark[]): Promise<boolean> {
    return write(() => store.markRead(...idsOf(rows.filter((b) => b.read_at === null))));
  }

  function remove(rows: readonly Bookmark[]): void {
    undo.remove(...idsOf(rows));
  }

  // Each eligible row is downloaded like the row's own toggle does: the list
  // holds no bodies, so the full row is loaded first. A row with no body to
  // save (still processing, or it couldn't be loaded) counts as not saved.
  async function saveOffline(rows: readonly Bookmark[]): Promise<void> {
    const eligible = rows.filter((b) => offersSaveOffline(b, offlineCache.isCached(b.id)));
    let failed = 0;
    await eachLimited(eligible, SAVE_OFFLINE_CONCURRENCY, async (bookmark) => {
      try {
        const full =
          bookmark.content_md === undefined ? await store.fetchOne(bookmark.id) : bookmark;
        if (!full?.content_md) throw new Error("No body to save");
        await offlineCache.cacheBookmark(full);
      } catch {
        failed += 1;
      }
    });
    if (failed > 0) {
      undo.fail(`Couldn't save ${failed} ${failed === 1 ? "item" : "items"} for offline reading.`);
    }
  }

  return { busy: readonly(busy), archive, unarchive, markRead, remove, saveOffline };
}
