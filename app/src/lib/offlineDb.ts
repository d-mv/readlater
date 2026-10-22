import { toRaw } from "vue";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Bookmark } from "./supabase";

export type OfflineBookmarkMeta = Omit<Bookmark, "content_md">;

export function stripContentMd(bookmark: Bookmark): OfflineBookmarkMeta {
  const { content_md: _content_md, ...meta } = bookmark;
  return meta;
}

// IndexedDB stores by structured clone, which throws DataCloneError on a Vue
// reactive proxy — and rows from the Pinia store are proxies all the way
// down (tags, …). Every write goes through this: arrays and plain objects are
// copied with their proxies unwrapped; anything else (Blob, Date) is kept.
export function toPlain<T>(value: T): T {
  const raw = toRaw(value);
  if (Array.isArray(raw)) return raw.map((item) => toPlain(item)) as T;
  if (raw !== null && typeof raw === "object") {
    const proto = Object.getPrototypeOf(raw);
    if (proto === Object.prototype || proto === null) {
      return Object.fromEntries(
        Object.entries(raw).map(([key, item]) => [key, toPlain(item)]),
      ) as T;
    }
  }
  return raw;
}

export interface CachedImage {
  url: string;
  blob: Blob;
}

export interface CachedArticle {
  id: string;
  content_md: string;
  // Cached DeepL translation, if the article had one when it was cached.
  // Optional: records written before this field existed don't have it.
  translated_content_md?: string | null;
  images: CachedImage[];
  // Image URLs that could not be downloaded (mostly CORS-blocked hot links),
  // so the offline copy shows them broken. Optional: records written before
  // this field existed don't have it.
  missingImages?: string[];
  cachedAt: string;
  bookmark?: OfflineBookmarkMeta;
}

interface OfflineDbSchema extends DBSchema {
  articles: {
    key: string;
    value: CachedArticle;
    // Read with key cursors only: an index key cursor yields (index key,
    // primary key) without loading the record, so listing what is cached
    // never pulls the image blobs into memory.
    indexes: { cachedAt: string; missingImages: string[] };
  };
  bookmarksList: {
    key: string;
    value: OfflineBookmarkMeta;
  };
  syncState: {
    key: string;
    value: StoredListSyncState;
  };
}

// Where the persisted list stands relative to the server: `watermark` is the
// newest updated_at it reflects (delta sync asks only for rows changed or
// deleted since), `cursor`/`hasMore` the (created_at, id) keyset window it
// covers.
export interface ListSyncState {
  watermark: string;
  cursor: ListCursor | null;
  hasMore: boolean;
}

// The oldest paged row. created_at alone isn't unique — an import stamps
// many rows with the same instant — so id breaks the tie.
export interface ListCursor {
  created_at: string;
  id: string;
}

// The largest uuid: paired with an old created_at-only cursor, it keeps
// every row stamped at that instant inside the next page, which is where the
// old `created_at < cursor` filter could drop them.
const MAX_UUID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

// Sync state as stored before the cursor carried an id.
type StoredListSyncState = Omit<ListSyncState, "cursor"> & { cursor: ListCursor | string | null };

const DB_NAME = "read-later-offline";
const DB_VERSION = 3;
const SYNC_STATE_KEY = "list";

let dbPromise: Promise<IDBPDatabase<OfflineDbSchema>> | null = null;

function getDb() {
  dbPromise ??= openDB<OfflineDbSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore("articles", { keyPath: "id" });
        db.createObjectStore("bookmarksList", { keyPath: "id" });
      }
      if (oldVersion < 2) db.createObjectStore("syncState");
      // Newest step: upgrade() only runs while oldVersion < DB_VERSION (3), so
      // the skip branch exists only once a later version is added.
      /* v8 ignore else */
      if (oldVersion < 3) {
        // Built over the existing records by the browser. Records written
        // before missingImages existed simply aren't in that index (none
        // missing, as far as anyone knows).
        const articles = tx.objectStore("articles");
        articles.createIndex("cachedAt", "cachedAt");
        articles.createIndex("missingImages", "missingImages");
      }
    },
  });
  return dbPromise;
}

// Object URLs handed out for each cached article's images, keyed by article
// id then image URL. Offline list loads hydrate every cached article, so
// without reuse each load minted (and leaked) a new blob: URL per image;
// they are revoked when the article is re-cached or evicted.
const objectUrls = new Map<string, Map<string, string>>();

function revokeObjectUrls(id: string) {
  const urls = objectUrls.get(id);
  if (!urls) return;
  for (const url of urls.values()) URL.revokeObjectURL(url);
  objectUrls.delete(id);
}

export async function putArticle(article: CachedArticle): Promise<void> {
  const db = await getDb();
  await db.put("articles", toPlain(article));
  revokeObjectUrls(article.id);
}

export async function getArticle(id: string): Promise<CachedArticle | undefined> {
  const db = await getDb();
  return db.get("articles", id);
}

export async function deleteArticle(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("articles", id);
  revokeObjectUrls(id);
}

export interface CachedArticleInfo {
  id: string;
  cachedAt: string;
  // How many of its images the offline copy lacks.
  missingImages: number;
}

// What is cached, from the two indexes' key cursors — no record (and so no
// image blob) is read.
export async function listCachedArticles(): Promise<CachedArticleInfo[]> {
  const db = await getDb();
  const store = db.transaction("articles").store;
  // Every article has cachedAt, so the cachedAt index lists them all; only
  // those with missing images appear in the missingImages index.
  const missing = new Map<string, number>();
  for (
    let cursor = await store.index("missingImages").openKeyCursor();
    cursor;
    cursor = await cursor.continue()
  ) {
    missing.set(cursor.primaryKey, cursor.key.length);
  }
  const info: CachedArticleInfo[] = [];
  for (
    let cursor = await store.index("cachedAt").openKeyCursor();
    cursor;
    cursor = await cursor.continue()
  ) {
    info.push({
      id: cursor.primaryKey,
      cachedAt: cursor.key,
      missingImages: missing.get(cursor.primaryKey) ?? 0,
    });
  }
  return info;
}

export async function getAllArticles(): Promise<CachedArticle[]> {
  const db = await getDb();
  return db.getAll("articles");
}

// Writes the list and, when given, its sync state in one transaction, so a
// persisted watermark never runs ahead of the list it describes. Downloaded
// articles stay listed even once they leave `items`: their metadata is
// normally already in this store (cacheBookmark writes it there), so it is
// carried over by id — only a record from before that, whose metadata lives
// solely on the article, costs reading the article (and its blobs).
export async function replaceBookmarksList(
  items: OfflineBookmarkMeta[],
  syncState?: ListSyncState,
): Promise<void> {
  if (items.length === 0) return;
  const db = await getDb();
  const tx = db.transaction(["articles", "bookmarksList", "syncState"], "readwrite");
  const articles = tx.objectStore("articles");
  const list = tx.objectStore("bookmarksList");
  const byId = new Map(items.map((item) => [item.id, item] as const));

  const cachedIds = await articles.getAllKeys();
  const kept = await Promise.all(
    cachedIds
      .filter((id) => !byId.has(id))
      .map(async (id) => (await list.get(id)) ?? (await articles.get(id))?.bookmark),
  );
  for (const meta of kept) if (meta) byId.set(meta.id, meta);

  await list.clear();
  await Promise.all(Array.from(byId.values()).map((item) => list.put(toPlain(item))));
  if (syncState) await tx.objectStore("syncState").put(toPlain(syncState), SYNC_STATE_KEY);
  await tx.done;
}

export async function getSyncState(): Promise<ListSyncState | undefined> {
  const db = await getDb();
  const state = await db.get("syncState", SYNC_STATE_KEY);
  if (typeof state?.cursor !== "string") return state as ListSyncState | undefined;
  return { ...state, cursor: { created_at: state.cursor, id: MAX_UUID } };
}

export async function putBookmarkMeta(item: OfflineBookmarkMeta): Promise<void> {
  const db = await getDb();
  await db.put("bookmarksList", toPlain(item));
}

export async function getBookmarksList(): Promise<OfflineBookmarkMeta[]> {
  const db = await getDb();
  return db.getAll("bookmarksList");
}

export async function deleteBookmarkMeta(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("bookmarksList", id);
}

// Sign-out: empties every object store (whatever stores a later schema adds)
// in one transaction and releases the blob: URLs handed out for images.
export async function clearAll(): Promise<void> {
  const db = await getDb();
  const names = Array.from(db.objectStoreNames);
  const tx = db.transaction(names, "readwrite");
  await Promise.all(names.map((name) => tx.objectStore(name).clear()));
  await tx.done;
  for (const id of objectUrls.keys()) revokeObjectUrls(id);
}

export function hydrateArticleContent(
  article: Pick<CachedArticle, "id" | "content_md" | "images">,
  createObjectUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
): string {
  let urls = objectUrls.get(article.id);
  if (!urls) {
    urls = new Map();
    objectUrls.set(article.id, urls);
  }
  let content = article.content_md;
  for (const image of article.images) {
    let objectUrl = urls.get(image.url);
    if (!objectUrl) {
      objectUrl = createObjectUrl(image.blob);
      urls.set(image.url, objectUrl);
    }
    content = content.split(image.url).join(objectUrl);
  }
  return content;
}

// The reverse of hydrateArticleContent: an object URL only means something
// on this device, so content headed for the server (an edit made while the
// offline copy was shown) gets the images' original URLs back.
export function dehydrateContent(content: string): string {
  let result = content;
  for (const urls of objectUrls.values()) {
    for (const [original, objectUrl] of urls) {
      result = result.split(objectUrl).join(original);
    }
  }
  return result;
}

export async function _resetForTests(): Promise<void> {
  objectUrls.clear();
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
  }
  dbPromise = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error as Error);
    req.onblocked = () => resolve();
  });
}
