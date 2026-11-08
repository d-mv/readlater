import { acceptHMRUpdate, defineStore } from "pinia";
import { shallowRef } from "vue";
import { useBookmarksStore, type WriteResult } from "./bookmarks";

// How long the toast offers Undo. A delete reaches the server only after it.
export const UNDO_WINDOW_MS = 5000;

// What the toast shows: an action that can still be taken back, or a write
// that didn't happen (a delete or an undo the server refused).
export type UndoNotice =
  | { kind: "archived"; id: string }
  | { kind: "deleted"; id: string }
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
    const { error } = await useBookmarksStore().commitRemove();
    if (error) show({ kind: "failed", message: error });
  }

  async function archive(id: string): Promise<WriteResult> {
    const result = await useBookmarksStore().archive(id);
    if (result.error === null) {
      void commit();
      show({ kind: "archived", id });
    }
    return result;
  }

  function remove(id: string): void {
    void commit();
    useBookmarksStore().remove(id);
    show({ kind: "deleted", id });
  }

  async function undo(): Promise<void> {
    const current = notice.value;
    hide();
    if (current?.kind === "deleted") {
      useBookmarksStore().undoRemove(current.id);
    } else if (current?.kind === "archived") {
      const { error } = await useBookmarksStore().unarchive(current.id);
      if (error) show({ kind: "failed", message: error });
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

  return { notice, archive, remove, undo, flush, reset };
});

// Dev-server HMR wiring (see bookmarks.ts).
/* v8 ignore start */
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useUndoStore, import.meta.hot));
}
/* v8 ignore stop */
