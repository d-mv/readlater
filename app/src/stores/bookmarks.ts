import { acceptHMRUpdate, defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase, type AddBookmarkResult, type Bookmark } from "../lib/supabase";
import { detectBookmarkType } from "../utils/bookmarkType";
import { truncateTitle } from "../utils/captureText";
import { arrayBufferToBase64 } from "../utils/base64";
import { detectFileKind, maxBytesForFileKind } from "../utils/fileKind";
import { normalizeUrl } from "../utils/normalizeUrl";
import { readingTimeFromWordCount, wordCount } from "../utils/reading";
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
  "updated_at",
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
// PostgREST's answer to a JWT it no longer accepts (expired past refresh,
// revoked). A list read that gets it ends the login rather than falling back
// to the offline snapshot as if the network were down.
const UNAUTHORIZED = 401;

class SessionExpiredError extends Error {
  constructor() {
    super("Session expired");
  }
}

// What a store write reports back: null on success, otherwise a message for
// the user. Local state only changes once the server accepted the write, so a
// failed write can't leave this device showing a state the server never had
// (delta sync would never correct it — the row's updated_at didn't move).
export interface WriteResult {
  error: string | null;
}

const WRITE_FAILED = "Couldn't save the change. Check your connection and try again.";

function writeResult(error: unknown): WriteResult {
  return { error: error ? WRITE_FAILED : null };
}
const PAGE_SIZE = 50;
// A delta larger than this means the local copy is far behind; a fresh first
// page is cheaper than replaying it.
const DELTA_LIMIT = 200;
// updated_at is the writing transaction's start time, so a slow transaction
// can commit a row stamped just before the watermark. Re-asking for a short
// overlap catches those; applying a row twice is harmless.
const DELTA_OVERLAP_MS = 5 * 60_000;
const PDF_BUCKET = "bookmark-pdfs";
const PDF_SIGNED_URL_TTL_SECONDS = 60;
// Public bucket the worker uploads YouTube thumbnails to (worker/src/storage.ts).
const ASSETS_BUCKET = "bookmark-assets";

// PostgREST returns created_at with microseconds, which Date.parse drops —
// and rows an import stamped within the same millisecond differ only there.
function microseconds(timestamp: string): number {
  const fraction = /\.(\d+)/.exec(timestamp)?.[1] ?? "";
  return Number(fraction.slice(3, 6).padEnd(3, "0"));
}

function compareTimestamps(a: string, b: string): number {
  return Date.parse(a) - Date.parse(b) || microseconds(a) - microseconds(b);
}

// The list's keyset order, (created_at, id) — the order the server pages in,
// so the window a cursor bounds here matches the one it bounds there.
// Canonical lowercase uuids compare as strings the way Postgres compares them.
function compareKeys(a: offlineDb.ListCursor, b: offlineDb.ListCursor): number {
  const byTime = compareTimestamps(a.created_at, b.created_at);
  if (byTime !== 0) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function byCreatedAtDesc(a: Bookmark, b: Bookmark) {
  return compareKeys(b, a);
}

function cursorOf(row: Bookmark | undefined): offlineDb.ListCursor | null {
  return row ? { created_at: row.created_at, id: row.id } : null;
}

function latest(a: string | null, b: string): string {
  return a !== null && Date.parse(a) >= Date.parse(b) ? a : b;
}

// Online, the list must hold list-shaped rows (no body) so the reader pulls
// the real body with fetchOne(). Persisted metadata can still carry a
// translation (rows fetchOne() loaded are persisted whole but for
// content_md), and a stale body left in place would be what an edit saves or
// a translation sends.
function withoutBody(bookmark: offlineDb.OfflineBookmarkMeta): Bookmark {
  const { translated_content_md: _translation, ...row } = bookmark;
  const { content_md: _body, ...rest } = row as Partial<Bookmark>;
  return rest as Bookmark;
}

// The persisted list window for an online cold start: metadata only. Unlike
// loadOfflineBookmarks() it never opens the downloaded articles — their
// bodies and image blobs aren't wanted online.
async function loadPersistedList(): Promise<Bookmark[]> {
  const metas = await offlineDb.getBookmarksList().catch(() => []);
  return metas.map(withoutBody).sort(byCreatedAtDesc);
}

// A downloaded article's body and translation, with its cached images
// swapped for blob: URLs; `fallbackTranslation` when the copy has none.
function hydratedBodies(
  article: offlineDb.CachedArticle,
  fallbackTranslation: string | null,
): Pick<Bookmark, "content_md" | "translated_content_md"> {
  return {
    content_md: offlineDb.hydrateArticleContent(article),
    translated_content_md: article.translated_content_md
      ? offlineDb.hydrateArticleContent({ ...article, content_md: article.translated_content_md })
      : fallbackTranslation,
  };
}

// Stand-in row for a downloaded article whose metadata was never stored
// (cached before the cache kept it): readable, with nothing to show but the
// body.
function placeholderBookmark(article: offlineDb.CachedArticle): Bookmark {
  return {
    id: article.id,
    url: null,
    type: "article",
    status: "ready",
    title: "Offline Article",
    author: null,
    excerpt: null,
    ...hydratedBodies(article, null),
    translated_lang: null,
    thumbnail_url: null,
    youtube_video_id: null,
    content_edited: false,
    word_count: null,
    reading_time: null,
    tags: [],
    is_public: false,
    archived: false,
    read_at: null,
    error_message: null,
    created_at: article.cachedAt,
    processed_at: article.cachedAt,
    updated_at: article.cachedAt,
    pdf_path: null,
    pdf_parsed: false,
    view_mode: null,
    progress: 0,
  };
}

async function loadOfflineBookmarks(): Promise<Bookmark[]> {
  const [metaList, cachedArticles] = await Promise.all([
    offlineDb.getBookmarksList().catch(() => []),
    offlineDb.getAllArticles().catch(() => []),
  ]);

  const byId = new Map<string, Bookmark>();

  for (const article of cachedArticles) {
    const meta = article.bookmark;
    byId.set(
      article.id,
      meta
        ? { ...meta, ...hydratedBodies(article, meta.translated_content_md ?? null) }
        : placeholderBookmark(article),
    );
  }

  // The listed metadata is the fresher copy; a downloaded article keeps its
  // body. getAllArticles() already returned every downloaded article, so a
  // listed row not among them simply has no offline body.
  for (const meta of metaList) {
    const existing = byId.get(meta.id);
    byId.set(
      meta.id,
      existing
        ? {
            ...meta,
            content_md: existing.content_md,
            translated_content_md:
              existing.translated_content_md ?? meta.translated_content_md ?? null,
          }
        : { ...meta, content_md: null },
    );
  }

  return Array.from(byId.values()).sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  });
}

export type BookmarkFilter = "all" | "archived";

export const useBookmarksStore = defineStore("bookmarks", () => {
  const bookmarks = ref<Bookmark[]>([]);
  const filter = shallowRef<BookmarkFilter>("all");
  const loading = shallowRef(false);
  const loadingMore = shallowRef(false);
  // Whether an older page might still exist on the server (keyset pagination).
  const hasMore = shallowRef(false);
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

  // What `bookmarks` currently holds, so async results and live events can
  // tell whether they still apply:
  // - "recent": the unfiltered newest-first window, paged by `cursor` (the
  //   (created_at, id) of the oldest *paged* row — rows added by fetchOne()
  //   or Realtime don't move it), current as of `watermark` (the newest
  //   updated_at / deleted_at it reflects; null until a row has been seen).
  //   The only kind mirrored to the offline list.
  // - "search": a whole, unpaged full-text result set for `query`.
  // - "offline": a read-only snapshot from IndexedDB after a failed fetch.
  // Every fetch() bumps `listGeneration`; a response (fetch or loadMore)
  // started under an older generation is discarded.
  type ListSession =
    | { kind: "recent"; cursor: offlineDb.ListCursor | null; watermark: string | null }
    | { kind: "search"; query: string }
    | { kind: "offline"; query: string };
  let listSession: ListSession = { kind: "recent", cursor: null, watermark: null };
  let listGeneration = 0;

  // One page of the list, newest first. `query` applies full-text search;
  // tag filtering is resolved client-side against the loaded set (see
  // visibleBookmarks), so it costs no query. `before` is the keyset cursor
  // for loadMore(): rows strictly after it in (created_at desc, id desc)
  // order — created_at alone would skip the rest of a batch an import
  // stamped with the cursor row's instant. Values are quoted for PostgREST's
  // logic-tree syntax (timestamps contain `:` and `.`).
  async function queryBookmarks(
    opts: { query?: string; limit?: number; before?: offlineDb.ListCursor } = {},
  ): Promise<Bookmark[]> {
    let query = supabase.from("bookmarks").select(LIST_SELECT);

    if (opts.query) {
      query = query.textSearch("search_vector", opts.query, { type: "websearch" });
    }
    if (opts.before) {
      const { created_at: at, id } = opts.before;
      query = query.or(`created_at.lt."${at}",and(created_at.eq."${at}",id.lt."${id}")`);
    }
    if (opts.limit) query = query.limit(opts.limit);

    const { data, error, status } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (status === UNAUTHORIZED) throw new SessionExpiredError();
    if (error) throw error;
    return (data ?? []) as unknown as Bookmark[];
  }

  // Rows changed, and ids deleted, at or after `since`. At most
  // DELTA_LIMIT + 1 changed rows, so the caller can tell an oversized delta.
  async function queryDelta(since: string) {
    const [changed, deleted] = await Promise.all([
      supabase
        .from("bookmarks")
        .select(LIST_SELECT)
        .gte("updated_at", since)
        .limit(DELTA_LIMIT + 1)
        .order("updated_at", { ascending: true }),
      supabase
        .from("bookmark_deletions")
        .select("bookmark_id, deleted_at")
        .gte("deleted_at", since)
        .order("deleted_at", { ascending: true }),
    ]);
    if (changed.status === UNAUTHORIZED || deleted.status === UNAUTHORIZED) {
      throw new SessionExpiredError();
    }
    if (changed.error) throw changed.error;
    if (deleted.error) throw deleted.error;
    return {
      changed: (changed.data ?? []) as unknown as Bookmark[],
      deleted: (deleted.data ?? []) as { bookmark_id: string; deleted_at: string }[],
    };
  }

  // Whether a row belongs to the paged window — rows past the cursor in
  // keyset order arrive through loadMore(), fresh.
  function inWindow(row: Bookmark, cursor: offlineDb.ListCursor | null, more: boolean) {
    return !more || cursor === null || compareKeys(row, cursor) >= 0;
  }

  // Brings the "recent" list up to date by delta instead of re-reading the
  // first page: from the list already in memory, else from the persisted
  // snapshot (shown at once, then patched). Returns false when there is no
  // synced list to start from, or it is too far behind — the caller then
  // loads a fresh first page.
  async function syncRecent(isCurrent: () => boolean): Promise<boolean> {
    let cursor: offlineDb.ListCursor | null;
    let watermark: string;
    if (listSession.kind === "recent" && listSession.watermark !== null) {
      ({ cursor, watermark } = listSession);
    } else {
      const state = await offlineDb.getSyncState().catch(() => undefined);
      if (!state) return false;
      const snapshot = await loadPersistedList();
      if (!isCurrent()) return true;
      ({ cursor, watermark } = state);
      // Downloaded articles outside the window carry metadata of unknown age;
      // leave them for loadMore() rather than show them stale.
      bookmarks.value = snapshot.filter((b) => inWindow(b, cursor, state.hasMore));
      listSession = { kind: "recent", cursor, watermark };
      hasMore.value = state.hasMore;
    }

    const since = new Date(Date.parse(watermark) - DELTA_OVERLAP_MS).toISOString();
    const { changed, deleted } = await queryDelta(since);
    if (!isCurrent()) return true;
    if (changed.length > DELTA_LIMIT) return false;

    const gone = new Set(deleted.map((d) => d.bookmark_id));
    const byId = new Map(
      bookmarks.value.filter((b) => !gone.has(b.id)).map((b) => [b.id, b] as const),
    );
    for (const row of changed) {
      if (gone.has(row.id)) continue;
      const existing = byId.get(row.id);
      // Unchanged since loaded (the overlap re-sends recent rows): keep it,
      // with any body the reader already pulled.
      if (existing?.updated_at === row.updated_at) continue;
      if (existing || inWindow(row, cursor, hasMore.value)) byId.set(row.id, row);
    }
    for (const row of changed) watermark = latest(watermark, row.updated_at);
    for (const d of deleted) watermark = latest(watermark, d.deleted_at);

    // A downloaded copy would otherwise put a deleted row back into the
    // persisted list (replaceBookmarksList keeps cached articles' metadata).
    const offlineCache = useOfflineCacheStore();
    await Promise.all(
      [...gone].map((id) =>
        Promise.all([
          offlineDb.deleteBookmarkMeta(id),
          offlineCache.removeCachedBookmark(id),
        ]).catch(() => {}),
      ),
    );
    if (!isCurrent()) return true;

    bookmarks.value = [...byId.values()].sort(byCreatedAtDesc);
    listSession = { kind: "recent", cursor, watermark };
    persistOfflineList();
    return true;
  }

  async function fetch() {
    const generation = ++listGeneration;
    const isCurrent = () => generation === listGeneration;
    // Snapshot the query: the input can change while this request is in flight.
    const query = searchQuery.value.trim();
    loading.value = true;
    const auth = useAuthStore();
    try {
      const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
      // No session in memory while online: either the token refresh failed
      // for now, or the session is over — checkSession() tells them apart
      // and, for the latter, ends the login (the router then shows /login)
      // instead of leaving the offline snapshot up indefinitely.
      if (isOffline || !auth.userId || (!auth.session && !(await auth.checkSession()))) {
        throw new Error("Offline or session unavailable");
      }
      if (!query && (await syncRecent(isCurrent))) return;
      // A search result set is bounded and worth showing whole; only the
      // unfiltered list is paged.
      const page = await queryBookmarks(query ? { query } : { limit: PAGE_SIZE });
      if (!isCurrent()) return;
      bookmarks.value = page;
      if (query) {
        listSession = { kind: "search", query };
        hasMore.value = false;
      } else {
        let watermark: string | null = null;
        for (const row of page) watermark = latest(watermark, row.updated_at);
        listSession = { kind: "recent", cursor: cursorOf(page.at(-1)), watermark };
        hasMore.value = page.length === PAGE_SIZE;
        persistOfflineList();
      }
    } catch (err) {
      if (!isCurrent()) return;
      if (err instanceof SessionExpiredError) auth.sessionExpired();
      // Signed out (just now, or the check above found the session over):
      // the router is leaving for /login — don't put the snapshot up.
      if (!auth.userId) return;
      const offlineBookmarks = await loadOfflineBookmarks();
      if (!isCurrent()) return;
      const needle = query.toLowerCase();
      // Postgres full-text search doesn't run against the cached copy — fall
      // back to a plain substring match over title/excerpt (content_md isn't
      // cached in list metadata, so offline search can't reach article bodies).
      bookmarks.value = needle
        ? offlineBookmarks.filter(
            (b) =>
              b.title?.toLowerCase().includes(needle) || b.excerpt?.toLowerCase().includes(needle),
          )
        : offlineBookmarks;
      listSession = { kind: "offline", query };
      hasMore.value = false;
    } finally {
      if (isCurrent()) loading.value = false;
    }
  }

  // Appends the next older page. Only the unfiltered list pages; a no-op
  // during a search or offline, or while a page is in flight.
  async function loadMore() {
    const session = listSession;
    if (session.kind !== "recent" || !hasMore.value || loadingMore.value) return;
    if (!session.cursor) {
      hasMore.value = false;
      return;
    }
    const generation = listGeneration;
    loadingMore.value = true;
    try {
      const page = await queryBookmarks({ limit: PAGE_SIZE, before: session.cursor });
      // A fetch() started meanwhile (search, clear, refresh) owns the list now.
      if (generation !== listGeneration || listSession !== session) return;
      const seen = new Set(bookmarks.value.map((b) => b.id));
      bookmarks.value = [...bookmarks.value, ...page.filter((b) => !seen.has(b.id))];
      let watermark = session.watermark;
      for (const row of page) watermark = latest(watermark, row.updated_at);
      listSession = {
        kind: "recent",
        cursor: cursorOf(page.at(-1)) ?? session.cursor,
        watermark,
      };
      hasMore.value = page.length === PAGE_SIZE;
      persistOfflineList();
    } catch {
      // Leave hasMore untouched so the user can retry by scrolling again.
    } finally {
      loadingMore.value = false;
    }
  }

  function persistOfflineList() {
    // Only the unfiltered list is a true copy of "my recent bookmarks"; a
    // search result or an offline snapshot must never replace it.
    if (listSession.kind !== "recent") return;
    if (bookmarks.value.length === 0) return;
    const { cursor, watermark } = listSession;
    const syncState = watermark ? { watermark, cursor, hasMore: hasMore.value } : undefined;
    // Best-effort: private browsing / storage quota must not blank the list.
    offlineDb
      .replaceBookmarksList(
        bookmarks.value.map((b) => offlineDb.stripContentMd(b)),
        syncState,
      )
      .catch(() => {});
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
      // A search view is a filtered result; a new row may not match it, so
      // leave it out until the user re-runs the search.
      if (listSession.kind !== "recent" && listSession.query !== "") return;
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
      //
      // updated_at is NOT taken from the payload: the merged row may still
      // carry stale tags (attach/detach bumps updated_at) or a stale body, and
      // keeping the old stamp makes the next delta sync see a change and
      // replace the row with the server's full projection.
      if (!existing) return;
      const { updated_at: _changedAt, ...fields } = row;
      // The reader saves progress every couple of seconds and each save
      // echoes back here. Rewriting the persisted list for that alone is
      // pure IndexedDB churn — progress isn't worth a write; the next real
      // change (or page load) persists it along with everything else.
      const progressOnly = Object.entries(fields).every(
        ([key, value]) => key === "progress" || existing[key as keyof Bookmark] === value,
      );
      Object.assign(existing, fields);
      if (progressOnly) return;
    } else {
      // DELETE — the only event type left.
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

  // Sign-out: back to the empty state a fresh load starts from. Bumping the
  // generation discards any fetch or page still in flight, so the previous
  // account's rows can't land after the reset.
  function reset() {
    listGeneration += 1;
    listSession = { kind: "recent", cursor: null, watermark: null };
    bookmarks.value = [];
    filter.value = "all";
    loading.value = false;
    loadingMore.value = false;
    hasMore.value = false;
    searchQuery.value = "";
    activeTagIds.value = [];
  }

  // Puts a row the server just created at the top of the list. Its Realtime
  // INSERT can arrive before the insert's own response, in which case the
  // row is already listed: the response (the full row, tags included)
  // replaces it in place rather than adding a second copy.
  function addToList(row: Bookmark) {
    const index = bookmarks.value.findIndex((b) => b.id === row.id);
    if (index >= 0) bookmarks.value[index] = row;
    else bookmarks.value.unshift(row);
  }

  async function add(url: string, options?: { title?: string }): Promise<AddBookmarkResult> {
    let type: Bookmark["type"];
    try {
      type = detectBookmarkType(url);
    } catch {
      return { error: "Enter a valid http(s) URL." };
    }

    // The signed-in user is already held in memory by the auth store (kept
    // fresh via onAuthStateChange) — no need for a getUser() round-trip.
    const userId = useAuthStore().userId;
    if (!userId) return { error: "You must be signed in." };

    const loaded = bookmarks.value.find((b) => b.url === url);
    if (loaded) {
      return {
        error: null,
        duplicate: true,
        existingId: loaded.id,
        existingTitle: loaded.title,
        existingSavedAt: loaded.created_at,
      };
    }

    const { data, error } = await supabase
      .from("bookmarks")
      .insert({ url, title: options?.title, type, status: "pending", user_id: userId })
      .select(DETAIL_SELECT)
      .single();

    if (error) {
      // The local check above only catches URLs already loaded into this
      // session's list (e.g. archived items that weren't fetched); the DB's
      // per-user unique index on the normalized URL is the source of truth.
      if (error.code === UNIQUE_VIOLATION) {
        const existing = await findByNormalizedUrl(userId, url);
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

    addToList(data);
    return { error: null };
  }

  async function addNote(text: string): Promise<{ error: string | null }> {
    const trimmed = text.trim();
    if (!trimmed) return { error: "Note text is empty." };

    const userId = useAuthStore().userId;
    if (!userId) return { error: "You must be signed in." };

    const words = wordCount(trimmed);
    const { data, error } = await supabase
      .from("bookmarks")
      .insert({
        url: null,
        title: truncateTitle(trimmed),
        content_md: trimmed,
        type: "note",
        status: "ready",
        word_count: words,
        reading_time: readingTimeFromWordCount(words),
        user_id: userId,
      })
      .select(DETAIL_SELECT)
      .single();

    if (error) return { error: error.message };

    addToList(data);
    return { error: null };
  }

  async function addSnippet(html: string, text: string): Promise<{ error: string | null }> {
    const { data, error } = await supabase.functions.invoke("snippet", { body: { html, text } });
    if (error) return { error: error.message };

    addToList(data.bookmark);
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

    addToList(data.bookmark);
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

    addToList(data.bookmark);
    return { error: null };
  }

  async function setViewMode(id: string, mode: "markdown" | "original"): Promise<WriteResult> {
    const { error } = await supabase.from("bookmarks").update({ view_mode: mode }).eq("id", id);
    if (error) return writeResult(error);
    const bookmark = bookmarks.value.find((b) => b.id === id);
    if (bookmark) bookmark.view_mode = mode;
    return writeResult(null);
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

  // `text` is the body the reader is showing. It is not sent: the translate
  // function loads the article itself by bookmark_id (so a client can't have
  // arbitrary text translated and cached on a row). It is kept to notice an
  // edit that lands while the translation is in flight.
  async function translateBookmark(
    id: string,
    text: string,
    targetLang: string,
  ): Promise<{ translatedText: string | null; error: string | null }> {
    const { data, error } = await supabase.functions.invoke("translate", {
      body: { bookmark_id: id, target_lang: targetLang },
    });
    if (error) return { translatedText: null, error: error.message };

    const bookmark = bookmarks.value.find((b) => b.id === id);
    // DeepL can take seconds; if the text was edited meanwhile, this is a
    // translation of text that no longer exists. The edge function has
    // already cached it on the row, so clear that copy too.
    if (bookmark && bookmark.content_md !== text) {
      await supabase
        .from("bookmarks")
        .update({ translated_content_md: null, translated_lang: null })
        .eq("id", id);
      return { translatedText: null, error: "The text changed while translating. Try again." };
    }
    if (bookmark) {
      bookmark.translated_content_md = data.translated_text;
      bookmark.translated_lang = data.translated_lang;
      refreshOfflineCopy(bookmark);
    }
    return { translatedText: data.translated_text, error: null };
  }

  // URLs are unique per user (bookmarks_user_url_normalized_uniq). RLS already
  // limits the read to the caller's rows; the explicit owner filter keeps the
  // lookup matching the index rather than leaning on RLS for correctness.
  async function findByNormalizedUrl(userId: string, url: string) {
    const normalized = normalizeUrl(url);
    const { data } = await supabase
      .from("bookmarks")
      .select("id, title, created_at")
      .eq("user_id", userId)
      .eq("url_normalized", normalized)
      .maybeSingle();
    return data;
  }

  async function refresh(id: string): Promise<WriteResult> {
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
      return writeResult(null);
    }

    const { error } = await supabase
      .from("bookmarks")
      .update({ status: "pending", error_message: null, content_edited: false })
      .eq("id", id);
    if (error) return writeResult(error);
    if (bookmark) {
      bookmark.status = "pending";
      bookmark.error_message = null;
      bookmark.content_edited = false;
    }
    return writeResult(null);
  }

  async function fetchOne(id: string): Promise<Bookmark | null> {
    try {
      const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
      if (isOffline) {
        throw new Error("Offline");
      }
      const { data, error } = await supabase
        .from("bookmarks")
        .select(DETAIL_SELECT)
        .eq("id", id)
        .single();
      if (!error && data) {
        const index = bookmarks.value.findIndex((b) => b.id === id);
        if (index >= 0) {
          bookmarks.value[index] = data;
        } else {
          bookmarks.value.push(data);
        }
        return data;
      }
    } catch {
      // Network failure, continue to offline fallback
    }

    const cachedArticle = await offlineDb.getArticle(id).catch(() => undefined);
    const existing = bookmarks.value.find((b) => b.id === id);
    const metaList = !existing ? await offlineDb.getBookmarksList().catch(() => []) : [];
    const meta = existing ?? metaList.find((m) => m.id === id) ?? cachedArticle?.bookmark;

    if (meta) {
      const hydrated: Bookmark = {
        ...meta,
        ...(cachedArticle
          ? hydratedBodies(cachedArticle, meta.translated_content_md ?? null)
          : {
              content_md: (meta as Partial<Bookmark>).content_md ?? null,
              translated_content_md: meta.translated_content_md ?? null,
            }),
      };
      const index = bookmarks.value.findIndex((b) => b.id === id);
      if (index >= 0) {
        bookmarks.value[index] = hydrated;
      } else {
        bookmarks.value.push(hydrated);
      }
      return hydrated;
    }

    if (cachedArticle) {
      const hydrated = placeholderBookmark(cachedArticle);
      bookmarks.value.push(hydrated);
      return hydrated;
    }

    return null;
  }

  async function updateContent(
    id: string,
    fields: { title: string; content_md: string; word_count: number; reading_time: number },
  ): Promise<WriteResult> {
    // Editing content invalidates any cached translation — it was translated
    // from text that no longer matches, so keeping it would silently show a
    // stale translation on next open.
    const update = {
      ...fields,
      content_edited: true,
      translated_content_md: null,
      translated_lang: null,
    };
    const { error } = await supabase.from("bookmarks").update(update).eq("id", id);
    if (error) return writeResult(error);
    const bookmark = bookmarks.value.find((b) => b.id === id);
    if (bookmark) {
      Object.assign(bookmark, update);
      refreshOfflineCopy(bookmark);
    }
    return writeResult(null);
  }

  // Best-effort: keeps an offline copy in step with an edited body or a new
  // translation; a failure just leaves the previous copy in place.
  function refreshOfflineCopy(bookmark: Bookmark) {
    useOfflineCacheStore()
      .refreshCached({ ...bookmark })
      .catch(() => {});
  }

  async function setPublic(id: string, isPublic: boolean): Promise<WriteResult> {
    const { error } = await supabase.from("bookmarks").update({ is_public: isPublic }).eq("id", id);
    if (error) return writeResult(error);
    const bookmark = bookmarks.value.find((b) => b.id === id);
    if (bookmark) bookmark.is_public = isPublic;
    return writeResult(null);
  }

  async function addTag(bookmarkId: string, name: string): Promise<WriteResult> {
    const trimmed = name.trim();
    if (!trimmed) return writeResult(null);

    const userId = useAuthStore().userId;
    if (!userId) return { error: "You must be signed in." };

    // Tags are per user — unique on (user_id, name) — so the owner goes in
    // the row and the conflict target.
    const { data: tag, error: tagError } = await supabase
      .from("tags")
      .upsert(
        { name: trimmed, user_id: userId },
        { onConflict: "user_id,name", ignoreDuplicates: false },
      )
      .select("id, name, color")
      .single();
    if (tagError || !tag) return writeResult(tagError ?? "no tag");

    const { error: joinError } = await supabase
      .from("bookmark_tags")
      .upsert({ bookmark_id: bookmarkId, tag_id: tag.id }, { onConflict: "bookmark_id,tag_id" });
    if (joinError) return writeResult(joinError);

    const bookmark = bookmarks.value.find((b) => b.id === bookmarkId);
    if (bookmark && !bookmark.tags.some((t) => t.id === tag.id)) {
      bookmark.tags.push(tag);
    }
    return writeResult(null);
  }

  async function removeTag(bookmarkId: string, tagId: string): Promise<WriteResult> {
    const { error } = await supabase
      .from("bookmark_tags")
      .delete()
      .eq("bookmark_id", bookmarkId)
      .eq("tag_id", tagId);
    if (error) return writeResult(error);
    const bookmark = bookmarks.value.find((b) => b.id === bookmarkId);
    if (bookmark) bookmark.tags = bookmark.tags.filter((t) => t.id !== tagId);
    return writeResult(null);
  }

  async function markRead(id: string): Promise<WriteResult> {
    const read_at = new Date().toISOString();
    const { error } = await supabase.from("bookmarks").update({ read_at }).eq("id", id);
    if (error) return writeResult(error);
    const bookmark = bookmarks.value.find((b) => b.id === id);
    if (bookmark) bookmark.read_at = read_at;
    return writeResult(null);
  }

  async function markUnread(id: string): Promise<WriteResult> {
    const { error } = await supabase.from("bookmarks").update({ read_at: null }).eq("id", id);
    if (error) return writeResult(error);
    const bookmark = bookmarks.value.find((b) => b.id === id);
    if (bookmark) bookmark.read_at = null;
    return writeResult(null);
  }

  async function archive(id: string): Promise<WriteResult> {
    const { error } = await supabase.from("bookmarks").update({ archived: true }).eq("id", id);
    if (error) return writeResult(error);
    const bookmark = bookmarks.value.find((b) => b.id === id);
    if (bookmark) bookmark.archived = true;
    await useOfflineCacheStore()
      .removeCachedBookmark(id)
      .catch(() => {});
    return writeResult(null);
  }

  // Optimistic, unlike the other writes: the reader navigates back to the
  // list without waiting, so the row leaves the list at once and is put back
  // where it was if the server refuses the delete.
  async function remove(id: string): Promise<WriteResult> {
    const index = bookmarks.value.findIndex((b) => b.id === id);
    const removed = index === -1 ? undefined : bookmarks.value[index];
    bookmarks.value = bookmarks.value.filter((b) => b.id !== id);
    const { error } = await supabase.from("bookmarks").delete().eq("id", id);
    if (error) {
      if (removed && !bookmarks.value.some((b) => b.id === id)) {
        bookmarks.value.splice(Math.min(index, bookmarks.value.length), 0, removed);
      }
      return writeResult(error);
    }
    if (removed) {
      try {
        removeStorageObjects(removed);
      } catch {
        // Best-effort: the server-side orphan sweep is the backstop.
      }
    }
    await offlineDb.deleteBookmarkMeta(id).catch(() => {});
    await useOfflineCacheStore()
      .removeCachedBookmark(id)
      .catch(() => {});
    return writeResult(null);
  }

  // Deleting the row leaves its Storage objects behind: the original PDF and
  // a YouTube thumbnail the worker copied into our assets bucket (any other
  // thumbnail is a hot link, not ours). Fire-and-forget, after the delete
  // succeeded — nothing waits on it, and a failure (or a row that wasn't
  // loaded here) is left to the server-side orphan sweep.
  function removeStorageObjects(bookmark: Bookmark) {
    const removals: PromiseLike<unknown>[] = [];
    if (bookmark.pdf_path) {
      removals.push(supabase.storage.from(PDF_BUCKET).remove([bookmark.pdf_path]));
    }
    const assets = supabase.storage.from(ASSETS_BUCKET);
    const publicPrefix = assets.getPublicUrl("").data.publicUrl;
    const thumbnail = bookmark.thumbnail_url;
    if (thumbnail?.startsWith(publicPrefix)) {
      const path = decodeURIComponent(thumbnail.slice(publicPrefix.length).split("?")[0]);
      if (path) removals.push(assets.remove([path]));
    }
    void Promise.allSettled(removals);
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
    loadingMore,
    hasMore,
    searchQuery,
    activeTagIds,
    visibleBookmarks,
    unreadCount,
    allTags,
    setFilter,
    setSearchQuery,
    setActiveTagIds,
    fetch,
    loadMore,
    subscribeToChanges,
    unsubscribeFromChanges,
    reset,
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

// Dev-server HMR wiring: whether import.meta.hot exists depends on the runner,
// not on any app behaviour, so coverage of this branch is meaningless.
/* v8 ignore start */
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useBookmarksStore, import.meta.hot));
}
/* v8 ignore stop */
