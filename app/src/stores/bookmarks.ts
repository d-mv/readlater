import { acceptHMRUpdate, defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase, type Bookmark, type DuplicateBookmark } from "../lib/supabase";
import { detectBookmarkType } from "../utils/bookmarkType";
import { truncateTitle } from "../utils/captureText";
import { arrayBufferToBase64 } from "../utils/base64";
import { detectFileKind, maxBytesForFileKind } from "../utils/fileKind";
import { normalizeUrl } from "../utils/normalizeUrl";
import * as offlineDb from "../lib/offlineDb";
import { useAuthStore } from "./auth";
import { useOfflineCacheStore } from "./offlineCache";

// Full row, article bodies included — only for the reader (fetchOne) and the
// insert paths, which touch one row at a time.
const DETAIL_SELECT = "*, tags(id, name, color)";
// The list view never renders article bodies, so the list query deliberately
// omits the large text columns (content_md, translated_content_md) and the
// generated tsvector. For a personal-scale library that is the difference
// between a few hundred KB and several MB on every list load / filter change.
// The reader pulls the body via fetchOne() when an article is actually opened.
const LIST_COLUMNS = [
  "id",
  "url",
  "type",
  "status",
  "title",
  "author",
  "excerpt",
  "thumbnail_url",
  "youtube_video_id",
  "content_edited",
  "word_count",
  "reading_time",
  "is_public",
  "archived",
  "read_at",
  "error_message",
  "created_at",
  "processed_at",
  "pdf_path",
  "pdf_parsed",
  "view_mode",
  "progress",
  // Enough to drive the "translated" list badge without pulling the translation
  // text itself.
  "translated_lang",
].join(", ");
const LIST_SELECT = `${LIST_COLUMNS}, tags(id, name, color)`;
const UNIQUE_VIOLATION = "23505";
const PDF_BUCKET = "bookmark-pdfs";
const PDF_SIGNED_URL_TTL_SECONDS = 60;

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

  const visibleBookmarks = computed(() => {
    const wantArchived = filter.value === "archived";
    const tagIds = activeTagIds.value;
    return bookmarks.value.filter((b) => {
      if (b.archived !== wantArchived) return false;
      if (tagIds.length === 0) return true;
      // Match-all: every selected tag must be present on the bookmark. Tags
      // are already embedded on each loaded row, so this needs no extra query.
      const own = new Set((b.tags ?? []).map((t) => t.id));
      return tagIds.every((id) => own.has(id));
    });
  });

  const unreadCount = computed(
    () => bookmarks.value.filter((b) => !b.archived && b.read_at === null).length,
  );

  // Derived from tags already attached to loaded bookmarks, not a separate
  // query — fine at personal-library scale, and means the filter bar only
  // ever shows tags that are actually in use.
  const allTags = computed(() => {
    const byId = new Map<string, Bookmark["tags"][number]>();
    for (const bookmark of bookmarks.value) {
      for (const tag of bookmark.tags ?? []) byId.set(tag.id, tag);
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

  // Applies the active full-text search filter and ordering. Tag filtering is
  // resolved client-side against the loaded set (see visibleBookmarks), so it
  // costs no query.
  async function queryBookmarks<T>(select: string): Promise<T[]> {
    let query = supabase.from("bookmarks").select(select);

    const trimmedQuery = searchQuery.value.trim();
    if (trimmedQuery) {
      query = query.textSearch("search_vector", trimmedQuery, { type: "websearch" });
    }

    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as T[];
  }

  async function fetch() {
    loading.value = true;
    try {
      bookmarks.value = await queryBookmarks<Bookmark>(LIST_SELECT);
      persistOfflineList();
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
    } finally {
      loading.value = false;
    }
  }

  function persistOfflineList() {
    // Best-effort: private browsing / storage quota must not blank the list.
    offlineDb.replaceBookmarksList(bookmarks.value.map(stripContentMd)).catch(() => {});
  }

  // A single postgres_changes subscription keeps `bookmarks` live without the
  // client polling the REST API: a capture from another tab (bookmarklet
  // popup, share target), or the worker marking an article ready, lands here
  // directly. The stream is RLS-scoped to the signed-in user and — by the
  // publication's column list — carries no article bodies; the reader pulls
  // those via fetchOne() on open.
  let channel: RealtimeChannel | undefined;

  function applyChange(payload: RealtimePostgresChangesPayload<Bookmark>) {
    if (payload.eventType === "INSERT") {
      // A search view is a filtered server result; a new row may not match it,
      // so leave it out until the user re-runs the search.
      if (searchQuery.value.trim() !== "") return;
      const row = { ...(payload.new as Bookmark), tags: payload.new.tags ?? [] };
      if (!bookmarks.value.some((b) => b.id === row.id)) {
        bookmarks.value = [row, ...bookmarks.value];
      }
    } else if (payload.eventType === "UPDATE") {
      const row = payload.new as Bookmark;
      const existing = bookmarks.value.find((b) => b.id === row.id);
      // Merge, don't replace: the payload has no body columns, so a body the
      // reader already loaded for this row must survive. tags is a join, never
      // in a Realtime payload, so it is preserved too.
      if (existing) Object.assign(existing, row);
    } else if (payload.eventType === "DELETE") {
      const id = (payload.old as { id?: string }).id;
      if (id) bookmarks.value = bookmarks.value.filter((b) => b.id !== id);
    }
    persistOfflineList();
  }

  function subscribeToChanges() {
    if (channel) return;
    channel = supabase
      .channel("bookmarks-changes")
      .on<Bookmark>(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookmarks" },
        applyChange,
      )
      .subscribe();
  }

  function unsubscribeFromChanges() {
    if (!channel) return;
    supabase.removeChannel(channel);
    channel = undefined;
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

    // The signed-in user is already held in memory by the auth store (kept
    // fresh via onAuthStateChange) — no need for a getUser() round-trip.
    const userId = useAuthStore().userId;
    if (!userId) return { error: "You must be signed in." };

    if (!options?.force && bookmarks.value.some((b) => b.url === url)) {
      return { error: null, duplicate: true };
    }

    const { data, error } = await supabase
      .from("bookmarks")
      .insert({ url, title: options?.title, type, status: "pending", user_id: userId })
      .select(DETAIL_SELECT)
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

    const userId = useAuthStore().userId;
    if (!userId) return { error: "You must be signed in." };

    const { data, error } = await supabase
      .from("bookmarks")
      .insert({
        url: null,
        title: truncateTitle(trimmed),
        content_md: trimmed,
        type: "note",
        status: "ready",
        user_id: userId,
      })
      .select(DETAIL_SELECT)
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

  // Markdown/Word: read, converted to Markdown notes, and the original is
  // discarded — unlike PDFs, there's no reason to keep these around.
  async function addFile(file: File): Promise<{ error: string | null }> {
    const kind = detectFileKind(file.name);
    if (kind !== "markdown" && kind !== "docx") {
      return { error: "Unsupported file type. Use .md, .markdown, or .docx." };
    }

    const maxBytes = maxBytesForFileKind(kind);
    if (file.size > maxBytes) {
      const limit = kind === "markdown" ? "500KB" : "5MB";
      return { error: `File exceeds the ${limit} limit for this file type.` };
    }

    const contentBase64 = arrayBufferToBase64(await file.arrayBuffer());
    const { data, error } = await supabase.functions.invoke("file-import", {
      body: { filename: file.name, contentBase64 },
    });
    if (error) return { error: error.message };

    bookmarks.value.unshift(data.bookmark);
    return { error: null };
  }

  // PDFs go through server-side text extraction; the original is kept in
  // Storage (see trashOriginalPdf) since extraction isn't always usable.
  async function addPdf(file: File): Promise<{ error: string | null }> {
    if (detectFileKind(file.name) !== "pdf") return { error: "Unsupported file type. Use .pdf." };

    if (file.size > maxBytesForFileKind("pdf")) {
      return { error: "File exceeds the 20MB limit for PDFs." };
    }

    const contentBase64 = arrayBufferToBase64(await file.arrayBuffer());
    const { data, error } = await supabase.functions.invoke("pdf-import", {
      body: { filename: file.name, contentBase64 },
    });
    if (error) return { error: error.message };

    bookmarks.value.unshift(data.bookmark);
    return { error: null };
  }

  async function setViewMode(id: string, mode: "markdown" | "original"): Promise<void> {
    await supabase.from("bookmarks").update({ view_mode: mode }).eq("id", id);
    const bookmark = bookmarks.value.find((b) => b.id === id);
    if (bookmark) bookmark.view_mode = mode;
  }

  async function getPdfSignedUrl(
    pdfPath: string,
  ): Promise<{ url: string | null; error: string | null }> {
    const { data, error } = await supabase.storage
      .from(PDF_BUCKET)
      .createSignedUrl(pdfPath, PDF_SIGNED_URL_TTL_SECONDS);
    if (error) return { url: null, error: error.message };
    return { url: data.signedUrl, error: null };
  }

  // Only offered once parsing succeeded — content_md then stands on its own,
  // so the original can go without losing the ability to read the bookmark.
  async function trashOriginalPdf(id: string): Promise<{ error: string | null }> {
    const bookmark = bookmarks.value.find((b) => b.id === id);
    if (!bookmark?.pdf_path) return { error: null };

    const { error: removeError } = await supabase.storage
      .from(PDF_BUCKET)
      .remove([bookmark.pdf_path]);
    if (removeError) return { error: removeError.message };

    const update = { pdf_path: null, view_mode: "markdown" as const };
    await supabase.from("bookmarks").update(update).eq("id", id);
    Object.assign(bookmark, update);
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
    const normalized = normalizeUrl(url);
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
    const { data } = await supabase.from("bookmarks").select(DETAIL_SELECT).eq("id", id).single();
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

  async function updateProgress(id: string, progress: number) {
    const rounded = Math.round(progress * 10000) / 10000;
    const bookmark = bookmarks.value.find((b) => b.id === id);
    if (bookmark) bookmark.progress = rounded;
    await supabase.from("bookmarks").update({ progress: rounded }).eq("id", id);
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
    subscribeToChanges,
    unsubscribeFromChanges,
    add,
    addNote,
    addSnippet,
    addFile,
    addPdf,
    setViewMode,
    getPdfSignedUrl,
    trashOriginalPdf,
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
    updateProgress,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useBookmarksStore, import.meta.hot));
}
