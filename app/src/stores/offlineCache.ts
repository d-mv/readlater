import { acceptHMRUpdate, defineStore } from "pinia";
import { computed, shallowRef } from "vue";
import type { Bookmark } from "../lib/supabase";
import * as offlineDb from "../lib/offlineDb";

const IMAGE_MARKDOWN_RE = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;

function extractImageUrls(contentMd: string, thumbnailUrl: string | null): string[] {
  const urls = new Set<string>();
  for (const match of contentMd.matchAll(IMAGE_MARKDOWN_RE)) {
    urls.add(match[1]);
  }
  if (thumbnailUrl) urls.add(thumbnailUrl);
  return [...urls];
}

// Hot-linked source images often refuse cross-origin reads (CORS), and an
// error response is not the image either; both are reported as missing so the
// UI can say the offline copy is incomplete.
async function downloadImages(
  urls: string[],
): Promise<{ images: offlineDb.CachedImage[]; missing: string[] }> {
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(url);
        if (!response.ok) return { url, blob: null };
        return { url, blob: await response.blob() };
      } catch {
        return { url, blob: null };
      }
    }),
  );
  return {
    images: results.filter((r): r is offlineDb.CachedImage => r.blob !== null),
    missing: results.filter((r) => r.blob === null).map((r) => r.url),
  };
}

export const useOfflineCacheStore = defineStore("offlineCache", () => {
  // Per-article offline state. "saving" covers the image downloads and the
  // IndexedDB write, so a second save reuses the first and a remove can
  // cancel it instead of racing it.
  const entries = shallowRef<ReadonlyMap<string, "saving" | "saved">>(new Map());
  // The save currently allowed to commit for each id; a remove (or a newer
  // save after one) replaces or deletes it, which is how an in-flight save
  // learns it has been superseded.
  const inFlight = new Map<string, Promise<void>>();

  // How many images each saved article's offline copy lacks; absent = none.
  const missing = shallowRef<ReadonlyMap<string, number>>(new Map());

  const cachedIds = computed(
    () => new Set([...entries.value].filter(([, state]) => state === "saved").map(([id]) => id)),
  );

  function setEntry(id: string, state: "saving" | "saved" | null) {
    const next = new Map(entries.value);
    if (state) next.set(id, state);
    else next.delete(id);
    entries.value = next;
  }

  function setMissing(id: string, count: number) {
    if ((missing.value.get(id) ?? 0) === count) return;
    const next = new Map(missing.value);
    if (count > 0) next.set(id, count);
    else next.delete(id);
    missing.value = next;
  }

  async function init() {
    const articles = await offlineDb.listCachedArticles();
    // Rebuild from IndexedDB, but keep saves that haven't been written yet.
    const next = new Map<string, "saving" | "saved">(articles.map((a) => [a.id, "saved"]));
    for (const [id, state] of entries.value) if (state === "saving") next.set(id, state);
    entries.value = next;
    missing.value = new Map(
      articles.filter((a) => a.missingImages > 0).map((a) => [a.id, a.missingImages]),
    );
  }

  function missingImageCount(id: string): number {
    return missing.value.get(id) ?? 0;
  }

  function isCached(id: string): boolean {
    return entries.value.get(id) === "saved";
  }

  function cacheBookmark(bookmark: Bookmark): Promise<void> {
    if (!bookmark.content_md || entries.value.get(bookmark.id) === "saved")
      return Promise.resolve();
    return inFlight.get(bookmark.id) ?? startSave(bookmark, { reuseExisting: true });
  }

  // Re-caches an article that is already offline (or being saved) after its
  // body or translation changed, so the offline copy doesn't go stale.
  function refreshCached(bookmark: Bookmark): Promise<void> {
    if (!bookmark.content_md || !entries.value.has(bookmark.id)) return Promise.resolve();
    return startSave(bookmark, { reuseExisting: false });
  }

  function startSave(bookmark: Bookmark, opts: { reuseExisting: boolean }): Promise<void> {
    const { id, content_md: contentMd } = bookmark;
    if (!contentMd) return Promise.resolve();

    const save: Promise<void> = (async () => {
      const isCurrent = () => inFlight.get(id) === save;
      try {
        const meta = offlineDb.stripContentMd(bookmark);
        if (opts.reuseExisting) {
          const existing = await offlineDb.getArticle(id);
          if (existing) {
            if (!existing.bookmark) {
              await offlineDb.putArticle({ ...existing, bookmark: meta });
              await offlineDb.putBookmarkMeta(meta);
            }
            if (isCurrent()) setEntry(id, "saved");
            return;
          }
        }

        const { images, missing: missingImages } = await downloadImages(
          extractImageUrls(contentMd, bookmark.thumbnail_url),
        );
        if (!isCurrent()) return;

        await offlineDb.putArticle({
          id,
          content_md: contentMd,
          translated_content_md: bookmark.translated_content_md ?? null,
          images,
          missingImages,
          cachedAt: new Date().toISOString(),
          bookmark: meta,
        });
        await offlineDb.putBookmarkMeta(meta);
        // Removed while the write was in progress: undo it.
        if (!isCurrent()) {
          if (!inFlight.has(id)) await offlineDb.deleteArticle(id);
          return;
        }
        setEntry(id, "saved");
        setMissing(id, missingImages.length);
      } catch (err) {
        if (isCurrent()) setEntry(id, null);
        throw err;
      } finally {
        if (isCurrent()) inFlight.delete(id);
      }
    })();

    // Replacing an in-flight save supersedes it: only the newest may commit.
    inFlight.set(id, save);
    if (entries.value.get(id) !== "saved") setEntry(id, "saving");
    return save;
  }

  async function removeCachedBookmark(id: string): Promise<void> {
    inFlight.delete(id);
    setEntry(id, null);
    setMissing(id, 0);
    await offlineDb.deleteArticle(id);
  }

  return {
    cachedIds,
    missingImageCounts: missing,
    init,
    isCached,
    missingImageCount,
    cacheBookmark,
    refreshCached,
    removeCachedBookmark,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useOfflineCacheStore, import.meta.hot));
}
