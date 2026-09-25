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
    const { id, content_md: contentMd } = bookmark;
    if (!contentMd || entries.value.get(id) === "saved") return Promise.resolve();
    const pending = inFlight.get(id);
    if (pending) return pending;

    const save: Promise<void> = (async () => {
      const isCurrent = () => inFlight.get(id) === save;
      try {
        // The reader auto-caches every article it opens; without this check
        // that re-downloads every inline image and rewrites the record on
        // each open of an article cached in a previous session.
        if (await offlineDb.getArticle(id)) {
          if (isCurrent()) setEntry(id, "saved");
          return;
        }

        const images = await downloadImages(extractImageUrls(contentMd, bookmark.thumbnail_url));
        if (!isCurrent()) return;

        await offlineDb.putArticle({
          id,
          content_md: contentMd,
          images,
          cachedAt: new Date().toISOString(),
        });
        // Removed while the write was in progress: undo it.
        if (!isCurrent()) {
          await offlineDb.deleteArticle(id);
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

    inFlight.set(id, save);
    setEntry(id, "saving");
    return save;
  }

  async function removeCachedBookmark(id: string): Promise<void> {
    inFlight.delete(id);
    setEntry(id, null);
    await offlineDb.deleteArticle(id);
  }

  return { cachedIds, init, isCached, cacheBookmark, removeCachedBookmark };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useOfflineCacheStore, import.meta.hot));
}
