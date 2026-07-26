import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Bookmark } from "./supabase";

export type OfflineBookmarkMeta = Omit<Bookmark, "content_md">;

export interface CachedImage {
  url: string;
  blob: Blob;
}

export interface CachedArticle {
  id: string;
  content_md: string;
  images: CachedImage[];
  cachedAt: string;
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
}

const DB_NAME = "read-later-offline";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<OfflineDbSchema>> | null = null;

function getDb() {
  dbPromise ??= openDB<OfflineDbSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore("articles", { keyPath: "id" });
      db.createObjectStore("bookmarksList", { keyPath: "id" });
    },
  });
  return dbPromise;
}

export async function putArticle(article: CachedArticle): Promise<void> {
  const db = await getDb();
  await db.put("articles", article);
}

export async function getArticle(id: string): Promise<CachedArticle | undefined> {
  const db = await getDb();
  return db.get("articles", id);
}

export async function deleteArticle(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("articles", id);
}

export async function listCachedArticleIds(): Promise<string[]> {
  const db = await getDb();
  return db.getAllKeys("articles");
}

export async function replaceBookmarksList(items: OfflineBookmarkMeta[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("bookmarksList", "readwrite");
  await tx.store.clear();
  await Promise.all(items.map((item) => tx.store.put(item)));
  await tx.done;
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
  article: Pick<CachedArticle, "content_md" | "images">,
  createObjectUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
): string {
  let content = article.content_md;
  for (const image of article.images) {
    content = content.split(image.url).join(createObjectUrl(image.blob));
  }
  return content;
}

export async function _resetForTests(): Promise<void> {
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
