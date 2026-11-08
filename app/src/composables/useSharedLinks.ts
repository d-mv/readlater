import { shallowRef } from "vue";
import { supabase } from "../lib/supabase";
import { useBookmarksStore } from "../stores/bookmarks";

// A bookmark with `is_public = true`, as the Settings "Shared links" list
// shows it. RLS scopes the read to the signed-in owner's rows.
export interface SharedLink {
  id: string;
  title: string | null;
  url: string | null;
  created_at: string;
}

export type SharedLinksState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; links: SharedLink[] };

export const SHARED_LINKS_LOAD_FAILED =
  "Couldn't load your shared links. Check your connection and try again.";

const SHARED_COLUMNS = "id, title, url, created_at";

export function useSharedLinks() {
  const state = shallowRef<SharedLinksState>({ status: "loading" });
  const revoking = shallowRef<ReadonlySet<string>>(new Set());
  const revokeError = shallowRef<string | null>(null);
  const bookmarks = useBookmarksStore();
  // Bumped by every load, so an older read (or a revoke that started before
  // it) can't overwrite what a newer one shows.
  let generation = 0;

  async function load(): Promise<void> {
    const current = ++generation;
    state.value = { status: "loading" };
    let next: SharedLinksState;
    try {
      // One query, newest first. No paging: PostgREST's max_rows (1000) is
      // far beyond how many links one person shares.
      const { data, error } = await supabase
        .from("bookmarks")
        .select(SHARED_COLUMNS)
        .eq("is_public", true)
        .order("created_at", { ascending: false });
      next = error
        ? { status: "error", message: SHARED_LINKS_LOAD_FAILED }
        : { status: "ready", links: (data ?? []) as SharedLink[] };
    } catch {
      next = { status: "error", message: SHARED_LINKS_LOAD_FAILED };
    }
    if (current === generation) state.value = next;
  }

  function setRevoking(id: string, on: boolean) {
    const next = new Set(revoking.value);
    if (on) next.add(id);
    else next.delete(id);
    revoking.value = next;
  }

  // Same write the reader's share dialog makes (store.setPublic), so a
  // bookmark already loaded in the list is updated too.
  async function revoke(id: string): Promise<void> {
    if (revoking.value.has(id)) return;
    const current = generation;
    revokeError.value = null;
    setRevoking(id, true);
    const { error } = await bookmarks.setPublic(id, false);
    setRevoking(id, false);
    if (error) {
      revokeError.value = error;
      return;
    }
    const shown = state.value;
    if (current === generation && shown.status === "ready") {
      state.value = { status: "ready", links: shown.links.filter((l) => l.id !== id) };
    }
  }

  return { state, revoking, revokeError, load, revoke };
}
