import { acceptHMRUpdate, defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import { supabase, type Bookmark, type DuplicateBookmark } from "../lib/supabase";
import { detectBookmarkType } from "../utils/bookmarkType";
import { truncateTitle } from "../utils/captureText";
import * as offlineDb from "../lib/offlineDb";
import { useOfflineCacheStore } from "./offlineCache";

const BOOKMARK_SELECT = "*, tags(id, name, color)";
const UNIQUE_VIOLATION = "23505";
const POLL_INTERVAL_MS = 5000;

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
  const searchQuery = shallowRef("");
  const activeTagIds = ref<string[]>([]);
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  const visibleBookmarks = computed(() =>
    bookmarks.value.filter((b) => (filter.value === "archived" ? b.archived : !b.archived)),
  );

  const unreadCount = computed(
    () => bookmarks.value.filter((b) => !b.archived && b.read_at === null).length,
  );

  // Derived from tags already attached to loaded bookmarks, not a separate
  // query — fine at personal-library scale, and means the filter bar only
  // ever shows tags that are actually in use.
  const allTags = computed(() => {
    const byId = new Map<string, Bookmark["tags"][number]>();
    for (const bookmark of bookmarks.value) {
      for (const tag of bookmark.tags) byId.set(tag.id, tag);
    }
    return [...byId.values()];
  });

  function setFilter(next: BookmarkFilter) {
    filter.value = next;
  }

  function setSearchQuery(next: string) {
    searchQuery.value = next;
  }

  function setActiveTagIds(next: string[]) {
    activeTagIds.value = next;
  }

  // Tags are a many-to-many join, so "match all selected tags" can't be
  // expressed as a single PostgREST filter on the bookmarks table — resolve
  // it as a separate lookup against bookmark_tags first.
  async function bookmarkIdsMatchingAllTags(tagIds: string[]): Promise<string[]> {
    const { data } = await supabase
      .from("bookmark_tags")
      .select("bookmark_id, tag_id")
      .in("tag_id", tagIds);
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      counts.set(row.bookmark_id, (counts.get(row.bookmark_id) ?? 0) + 1);
    }
    return [...counts.entries()].filter(([, count]) => count === tagIds.length).map(([id]) => id);
  }

  async function fetch() {
    loading.value = true;
    try {
      let query = supabase.from("bookmarks").select(BOOKMARK_SELECT);

      const trimmedQuery = searchQuery.value.trim();
      if (trimmedQuery) {
        query = query.textSearch("search_vector", trimmedQuery, { type: "websearch" });
      }

      if (activeTagIds.value.length > 0) {
        const matchingIds = await bookmarkIdsMatchingAllTags(activeTagIds.value);
        query = query.in("id", matchingIds);
      }

      const { data } = await query.order("created_at", { ascending: false });
      bookmarks.value = data ?? [];
    } catch {
      const offlineBookmarks = await loadOfflineBookmarks();
      const trimmedQuery = searchQuery.value.trim().toLowerCase();
      // Postgres full-text search doesn't run against the cached copy — fall
      // back to a plain substring match over title/excerpt (content_md isn't
      // cached in list metadata, so offline search can't reach article bodies).
      bookmarks.value = trimmedQuery
        ? offlineBookmarks.filter(
            (b) =>
              b.title?.toLowerCase().includes(trimmedQuery) ||
              b.excerpt?.toLowerCase().includes(trimmedQuery),
          )
        : offlineBookmarks;
      loading.value = false;
      return;
    }
    loading.value = false;
    // Best-effort: a failure here (e.g. private browsing, storage quota) must not blank the list we just rendered.
    offlineDb.replaceBookmarksList(bookmarks.value.map(stripContentMd)).catch(() => {});
  }

  // The list is otherwise loaded once on mount, so without this a bookmark
  // captured from another tab (bookmarklet popup, share target) or one still
  // being processed server-side never shows up or updates until the page is
  // reloaded.
  function startPolling() {
    if (pollTimer !== undefined) return;
    pollTimer = setInterval(() => {
      fetch();
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer === undefined) return;
    clearInterval(pollTimer);
    pollTimer = undefined;
  }

  async function add(
    url: string,
    options?: { force?: boolean; title?: string },
  ): Promise<{ error: string | null; duplicate?: boolean } & Partial<DuplicateBookmark>> {
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
      .insert({ url, title: options?.title, type, status: "pending", user_id: user.id })
      .select(BOOKMARK_SELECT)
      .single();

    if (error) {
      // The local check above only catches URLs already loaded into this
      // session's list (e.g. archived items that weren't fetched); the DB's
      // unique index on the normalized URL is the source of truth.
      if (error.code === UNIQUE_VIOLATION) {
        const existing = await findByNormalizedUrl(url);
        if (existing) {
          return {
            error: null,
            duplicate: true,
            existingId: existing.id,
            existingTitle: existing.title,
            existingSavedAt: existing.created_at,
          };
        }
      }
      return { error: error.message };
    }

    bookmarks.value.unshift(data);
    return { error: null };
  }

  async function addNote(text: string): Promise<{ error: string | null }> {
    const trimmed = text.trim();
    if (!trimmed) return { error: "Note text is empty." };

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "You must be signed in." };

    const { data, error } = await supabase
      .from("bookmarks")
      .insert({
        url: null,
        title: truncateTitle(trimmed),
        content_md: trimmed,
        type: "note",
        status: "ready",
        user_id: user.id,
      })
      .select(BOOKMARK_SELECT)
      .single();

    if (error) return { error: error.message };

    bookmarks.value.unshift(data);
    return { error: null };
  }

  async function addSnippet(html: string, text: string): Promise<{ error: string | null }> {
    const { data, error } = await supabase.functions.invoke("snippet", { body: { html, text } });
    if (error) return { error: error.message };

    bookmarks.value.unshift(data.bookmark);
    return { error: null };
  }

  async function translateBookmark(
    id: string,
    text: string,
    targetLang: string,
  ): Promise<{ translatedText: string | null; error: string | null }> {
    const { data, error } = await supabase.functions.invoke("translate", {
      body: { bookmark_id: id, text, target_lang: targetLang },
    });
    if (error) return { translatedText: null, error: error.message };

    const bookmark = bookmarks.value.find((b) => b.id === id);
    if (bookmark) {
      bookmark.translated_content_md = data.translated_text;
      bookmark.translated_lang = data.translated_lang;
    }
    return { translatedText: data.translated_text, error: null };
  }

  async function findByNormalizedUrl(url: string) {
    const normalized = url.toLowerCase().replace(/\/+$/, "");
    const { data } = await supabase
      .from("bookmarks")
      .select("id, title, created_at")
      .eq("url_normalized", normalized)
      .maybeSingle();
    return data;
  }

  async function refresh(id: string) {
    const bookmark = bookmarks.value.find((b) => b.id === id);
    // The duplicate-resave flow (share target / bookmarklet "already saved" prompt)
    // can target a bookmark that was never loaded into this session's list, so the
    // edited-content check can't always rely on local state alone.
    const contentEdited = bookmark
      ? bookmark.content_edited
      : Boolean(
          (await supabase.from("bookmarks").select("content_edited").eq("id", id).maybeSingle())
            .data?.content_edited,
        );

    if (
      contentEdited &&
      !window.confirm(
        "This was manually edited — refreshing will overwrite your changes. Continue?",
      )
    ) {
      return;
    }

    await supabase
      .from("bookmarks")
      .update({ status: "pending", error_message: null, content_edited: false })
      .eq("id", id);
    if (bookmark) {
      bookmark.status = "pending";
      bookmark.error_message = null;
      bookmark.content_edited = false;
    }
  }

  async function fetchOne(id: string): Promise<Bookmark | null> {
    const { data } = await supabase.from("bookmarks").select(BOOKMARK_SELECT).eq("id", id).single();
    if (!data) return null;

    const index = bookmarks.value.findIndex((b) => b.id === id);
    if (index >= 0) {
      bookmarks.value[index] = data;
    } else {
      bookmarks.value.push(data);
    }
    return data;
  }

  async function updateContent(
    id: string,
    fields: { title: string; content_md: string; word_count: number; reading_time: number },
  ) {
    // Editing content invalidates any cached translation — it was translated
    // from text that no longer matches, so keeping it would silently show a
    // stale translation on next open.
    const update = {
      ...fields,
      content_edited: true,
      translated_content_md: null,
      translated_lang: null,
    };
    await supabase.from("bookmarks").update(update).eq("id", id);
    const bookmark = bookmarks.value.find((b) => b.id === id);
    if (bookmark) Object.assign(bookmark, update);
  }

  async function setPublic(id: string, isPublic: boolean) {
    await supabase.from("bookmarks").update({ is_public: isPublic }).eq("id", id);
    const bookmark = bookmarks.value.find((b) => b.id === id);
    if (bookmark) bookmark.is_public = isPublic;
  }

  async function addTag(bookmarkId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;

    const { data: tag, error: tagError } = await supabase
      .from("tags")
      .upsert({ name: trimmed }, { onConflict: "name", ignoreDuplicates: false })
      .select("id, name, color")
      .single();
    if (tagError || !tag) return;

    const { error: joinError } = await supabase
      .from("bookmark_tags")
      .upsert({ bookmark_id: bookmarkId, tag_id: tag.id }, { onConflict: "bookmark_id,tag_id" });
    if (joinError) return;

    const bookmark = bookmarks.value.find((b) => b.id === bookmarkId);
    if (bookmark && !bookmark.tags.some((t) => t.id === tag.id)) {
      bookmark.tags.push(tag);
    }
  }

  async function removeTag(bookmarkId: string, tagId: string) {
    await supabase.from("bookmark_tags").delete().eq("bookmark_id", bookmarkId).eq("tag_id", tagId);
    const bookmark = bookmarks.value.find((b) => b.id === bookmarkId);
    if (bookmark) bookmark.tags = bookmark.tags.filter((t) => t.id !== tagId);
  }

  async function markRead(id: string) {
    const read_at = new Date().toISOString();
    await supabase.from("bookmarks").update({ read_at }).eq("id", id);
    const bookmark = bookmarks.value.find((b) => b.id === id);
    if (bookmark) bookmark.read_at = read_at;
  }

  async function markUnread(id: string) {
    await supabase.from("bookmarks").update({ read_at: null }).eq("id", id);
    const bookmark = bookmarks.value.find((b) => b.id === id);
    if (bookmark) bookmark.read_at = null;
  }

  async function archive(id: string) {
    await supabase.from("bookmarks").update({ archived: true }).eq("id", id);
    const bookmark = bookmarks.value.find((b) => b.id === id);
    if (bookmark) bookmark.archived = true;
    await useOfflineCacheStore()
      .removeCachedBookmark(id)
      .catch(() => {});
  }

  async function remove(id: string) {
    await supabase.from("bookmarks").delete().eq("id", id);
    bookmarks.value = bookmarks.value.filter((b) => b.id !== id);
    await offlineDb.deleteBookmarkMeta(id).catch(() => {});
    await useOfflineCacheStore()
      .removeCachedBookmark(id)
      .catch(() => {});
  }

  return {
    bookmarks,
    filter,
    loading,
    searchQuery,
    activeTagIds,
    visibleBookmarks,
    unreadCount,
    allTags,
    setFilter,
    setSearchQuery,
    setActiveTagIds,
    fetch,
    startPolling,
    stopPolling,
    add,
    addNote,
    addSnippet,
    translateBookmark,
    refresh,
    updateContent,
    fetchOne,
    markRead,
    markUnread,
    archive,
    remove,
    setPublic,
    addTag,
    removeTag,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useBookmarksStore, import.meta.hot));
}
