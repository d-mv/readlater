import { acceptHMRUpdate, defineStore } from "pinia";
import { shallowRef } from "vue";
import { useBookmarksStore, type WriteResult } from "./bookmarks";

// How long the toast offers Undo. A delete reaches the server only after it.
export const UNDO_WINDOW_MS = 5000;

// What the toast shows: an action that can still be taken back — on one row
// or a bulk selection, taken back as a whole — or a write that didn't happen
// (a delete, a bulk action or an undo the server refused).
export type UndoNotice =
  | { kind: "archived"; ids: string[] }
  | { kind: "unarchived"; ids: string[] }
  | { kind: "deleted"; ids: string[] }
  | { kind: "failed"; message: string };

// The undo toast (components/UndoToast.vue) and the actions it can take
// back. One notice at a time: a new one commits a delete still waiting.
export const useUndoStore = defineStore("undo", () => {
  const notice = shallowRef<UndoNotice | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function hide() {
    clearTimeout(timer);
    timer = undefined;
    notice.value = null;
  }

  // Every notice ends by committing — a no-op unless a delete is staged.
  function show(next: UndoNotice) {
    clearTimeout(timer);
    notice.value = next;
    timer = setTimeout(() => {
      hide();
      void commit();
    }, UNDO_WINDOW_MS);
  }

  async function commit(): Promise<void> {
    reportFailure(await useBookmarksStore().commitRemove());
  }

  function reportFailure({ error }: WriteResult): void {
    if (error) fail(error);
  }

  async function archive(...ids: string[]): Promise<WriteResult> {
    const result = await useBookmarksStore().archive(...ids);
    if (result.error === null) {
      void commit();
      show({ kind: "archived", ids });
    }
    return result;
  }

  // The Archived tab's bulk action; undo archives the rows again.
  async function unarchive(...ids: string[]): Promise<WriteResult> {
    const result = await useBookmarksStore().unarchive(...ids);
    if (result.error === null) {
      void commit();
      show({ kind: "unarchived", ids });
    }
    return result;
  }

  function remove(...ids: string[]): void {
    void commit();
    useBookmarksStore().remove(...ids);
    show({ kind: "deleted", ids });
  }

  // A write that didn't happen, shown in the toast's danger tone.
  function fail(message: string): void {
    show({ kind: "failed", message });
  }

  async function undo(): Promise<void> {
    const current = notice.value;
    hide();
    const store = useBookmarksStore();
    if (current?.kind === "deleted") {
      store.undoRemove(...current.ids);
    } else if (current?.kind === "archived" || current?.kind === "unarchived") {
      reportFailure(
        current.kind === "archived"
          ? await store.unarchive(...current.ids)
          : await store.archive(...current.ids),
      );
    }
  }

  // The app is going away (page hidden or closed, Sign out): a delete still
  // waiting for its undo window is sent now, or it would never be.
  async function flush(): Promise<void> {
    if (notice.value?.kind === "deleted") hide();
    await commit();
  }

  // The session ended: bookmarks.reset() has dropped any staged delete.
  function reset() {
    hide();
  }

  return { notice, archive, unarchive, remove, fail, undo, flush, reset };
});

// Dev-server HMR wiring (see bookmarks.ts).
/* v8 ignore start */
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useUndoStore, import.meta.hot));
}
/* v8 ignore stop */
