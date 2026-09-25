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

async function downloadImages(urls: string[]): Promise<{ url: string; blob: Blob }[]> {
  const images = await Promise.all(
    urls.map(async (url) => {
      try {
        const blob = await fetch(url).then((response) => response.blob());
        return { url, blob };
      } catch {
        return null;
      }
    }),
  );
  return images.filter((image): image is { url: string; blob: Blob } => image !== null);
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

  const cachedIds = computed(
    () => new Set([...entries.value].filter(([, state]) => state === "saved").map(([id]) => id)),
  );

  function setEntry(id: string, state: "saving" | "saved" | null) {
    const next = new Map(entries.value);
    if (state) next.set(id, state);
    else next.delete(id);
    entries.value = next;
  }

  async function init() {
    const ids = await offlineDb.listCachedArticleIds();
    // Rebuild from IndexedDB, but keep saves that haven't been written yet.
    const next = new Map<string, "saving" | "saved">(ids.map((id) => [id, "saved"]));
    for (const [id, state] of entries.value) if (state === "saving") next.set(id, state);
    entries.value = next;
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
        // The reader auto-caches every article it opens; without this check
        // that re-downloads every inline image and rewrites the record on
        // each open of an article cached in a previous session.
        if (opts.reuseExisting && (await offlineDb.getArticle(id))) {
          if (isCurrent()) setEntry(id, "saved");
          return;
        }

        const images = await downloadImages(extractImageUrls(contentMd, bookmark.thumbnail_url));
        if (!isCurrent()) return;

        await offlineDb.putArticle({
          id,
          content_md: contentMd,
          translated_content_md: bookmark.translated_content_md ?? null,
          images,
          cachedAt: new Date().toISOString(),
        });
        // Removed while the write was in progress: undo it.
        if (!isCurrent()) {
          if (!inFlight.has(id)) await offlineDb.deleteArticle(id);
          return;
        }
        setEntry(id, "saved");
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
    await offlineDb.deleteArticle(id);
  }

  return { cachedIds, init, isCached, cacheBookmark, refreshCached, removeCachedBookmark };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useOfflineCacheStore, import.meta.hot));
}
