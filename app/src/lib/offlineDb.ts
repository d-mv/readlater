import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Bookmark } from "./supabase";

export type OfflineBookmarkMeta = Omit<Bookmark, "content_md">;

export function stripContentMd(bookmark: Bookmark): OfflineBookmarkMeta {
  const { content_md: _content_md, ...meta } = bookmark;
  return meta;
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
  };
  bookmarksList: {
    key: string;
    value: OfflineBookmarkMeta;
  };
  syncState: {
    key: string;
    value: ListSyncState;
  };
}

// Where the persisted list stands relative to the server: `watermark` is the
// newest updated_at it reflects (delta sync asks only for rows changed or
// deleted since), `cursor`/`hasMore` the created_at keyset window it covers.
export interface ListSyncState {
  watermark: string;
  cursor: string | null;
  hasMore: boolean;
}

const DB_NAME = "read-later-offline";
const DB_VERSION = 2;
const SYNC_STATE_KEY = "list";

let dbPromise: Promise<IDBPDatabase<OfflineDbSchema>> | null = null;

function getDb() {
  dbPromise ??= openDB<OfflineDbSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore("articles", { keyPath: "id" });
        db.createObjectStore("bookmarksList", { keyPath: "id" });
      }
      if (oldVersion < 2) db.createObjectStore("syncState");
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
  await db.put("articles", article);
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

export async function listCachedArticles(): Promise<{ id: string; missingImages: number }[]> {
  const db = await getDb();
  const articles = await db.getAll("articles");
  return articles.map((a) => ({ id: a.id, missingImages: a.missingImages?.length ?? 0 }));
}

export async function getAllArticles(): Promise<CachedArticle[]> {
  const db = await getDb();
  return db.getAll("articles");
}

// Writes the list and, when given, its sync state in one transaction, so a
// persisted watermark never runs ahead of the list it describes.
export async function replaceBookmarksList(
  items: OfflineBookmarkMeta[],
  syncState?: ListSyncState,
): Promise<void> {
  if (items.length === 0) return;
  const db = await getDb();
  const articles = await db.getAll("articles");
  const byId = new Map<string, OfflineBookmarkMeta>();
  for (const item of items) {
    byId.set(item.id, item);
  }
  for (const article of articles) {
    if (article.bookmark && !byId.has(article.id)) {
      byId.set(article.id, article.bookmark);
    }
  }
  const tx = db.transaction(["bookmarksList", "syncState"], "readwrite");
  const list = tx.objectStore("bookmarksList");
  await list.clear();
  await Promise.all(Array.from(byId.values()).map((item) => list.put(item)));
  if (syncState) await tx.objectStore("syncState").put(syncState, SYNC_STATE_KEY);
  await tx.done;
}

export async function getSyncState(): Promise<ListSyncState | undefined> {
  const db = await getDb();
  return db.get("syncState", SYNC_STATE_KEY);
}

export async function putBookmarkMeta(item: OfflineBookmarkMeta): Promise<void> {
  const db = await getDb();
  await db.put("bookmarksList", item);
}

export async function getBookmarksList(): Promise<OfflineBookmarkMeta[]> {
  const db = await getDb();
  return db.getAll("bookmarksList");
}

export async function deleteBookmarkMeta(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("bookmarksList", id);
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
