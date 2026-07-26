import { acceptHMRUpdate, defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import { supabase, type Bookmark } from "../lib/supabase";
import { detectBookmarkType } from "../utils/bookmarkType";
import * as offlineDb from "../lib/offlineDb";
import { useOfflineCacheStore } from "./offlineCache";

function stripContentMd(bookmark: Bookmark): offlineDb.OfflineBookmarkMeta {
  const { content_md: _content_md, ...meta } = bookmark;
  return meta;
}

async function loadOfflineBookmarks(): Promise<Bookmark[]> {
  const metaList = await offlineDb.getBookmarksList();
  return Promise.all(
    metaList.map(async (meta) => {
      const article = await offlineDb.getArticle(meta.id);
      return { ...meta, content_md: article ? offlineDb.hydrateArticleContent(article) : null };
    }),
  );
}

export type BookmarkFilter = "all" | "archived";

export const useBookmarksStore = defineStore("bookmarks", () => {
  const bookmarks = ref<Bookmark[]>([]);
  const filter = shallowRef<BookmarkFilter>("all");
  const loading = shallowRef(false);

  const visibleBookmarks = computed(() =>
    bookmarks.value.filter((b) => (filter.value === "archived" ? b.archived : !b.archived)),
  );

  const unreadCount = computed(
    () => bookmarks.value.filter((b) => !b.archived && b.read_at === null).length,
  );

  function setFilter(next: BookmarkFilter) {
    filter.value = next;
  }

  async function fetch() {
    loading.value = true;
    try {
      const { data } = await supabase
        .from("bookmarks")
        .select("*")
        .order("created_at", { ascending: false });
      bookmarks.value = data ?? [];
    } catch {
      bookmarks.value = await loadOfflineBookmarks();
      loading.value = false;
      return;
    }
    loading.value = false;
    // Best-effort: a failure here (e.g. private browsing, storage quota) must not blank the list we just rendered.
    offlineDb.replaceBookmarksList(bookmarks.value.map(stripContentMd)).catch(() => {});
  }

  async function add(
    url: string,
    options?: { force?: boolean },
  ): Promise<{ error: string | null; duplicate?: boolean }> {
    let type: Bookmark["type"];
    try {
      type = detectBookmarkType(url);
    } catch {
      return { error: "Enter a valid URL." };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "You must be signed in." };

    if (!options?.force && bookmarks.value.some((b) => b.url === url)) {
      return { error: null, duplicate: true };
    }

    const { data, error } = await supabase
      .from("bookmarks")
      .insert({ url, type, status: "pending", user_id: user.id })
      .select()
      .single();

    if (error) return { error: error.message };

    bookmarks.value.unshift(data);
    return { error: null };
  }

  async function fetchOne(id: string): Promise<Bookmark | null> {
    const { data } = await supabase.from("bookmarks").select("*").eq("id", id).single();
    if (!data) return null;

    const index = bookmarks.value.findIndex((b) => b.id === id);
    if (index >= 0) {
      bookmarks.value[index] = data;
    } else {
      bookmarks.value.push(data);
    }
    return data;
  }

  async function markRead(id: string) {
    const read_at = new Date().toISOString();
    await supabase.from("bookmarks").update({ read_at }).eq("id", id);
    const bookmark = bookmarks.value.find((b) => b.id === id);
    if (bookmark) bookmark.read_at = read_at;
  }

  async function archive(id: string) {
    await supabase.from("bookmarks").update({ archived: true }).eq("id", id);
    const bookmark = bookmarks.value.find((b) => b.id === id);
    if (bookmark) bookmark.archived = true;
    await useOfflineCacheStore().removeCachedBookmark(id).catch(() => {});
  }

  async function remove(id: string) {
    await supabase.from("bookmarks").delete().eq("id", id);
    bookmarks.value = bookmarks.value.filter((b) => b.id !== id);
    await offlineDb.deleteBookmarkMeta(id).catch(() => {});
    await useOfflineCacheStore().removeCachedBookmark(id).catch(() => {});
  }

  return {
    bookmarks,
    filter,
    loading,
    visibleBookmarks,
    unreadCount,
    setFilter,
    fetch,
    add,
    fetchOne,
    markRead,
    archive,
    remove,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useBookmarksStore, import.meta.hot));
}
