import { acceptHMRUpdate, defineStore } from "pinia";
import { ref } from "vue";
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

export const useOfflineCacheStore = defineStore("offlineCache", () => {
  const cachedIds = ref<Set<string>>(new Set());

  async function init() {
    const ids = await offlineDb.listCachedArticleIds();
    cachedIds.value = new Set(ids);
  }

  function isCached(id: string): boolean {
    return cachedIds.value.has(id);
  }

  async function cacheBookmark(bookmark: Bookmark): Promise<void> {
    if (!bookmark.content_md) return;

    // The reader auto-caches every article it opens; without this guard that
    // re-downloads every inline image and rewrites the record on each open.
    if (cachedIds.value.has(bookmark.id) || (await offlineDb.getArticle(bookmark.id))) {
      if (!cachedIds.value.has(bookmark.id)) {
        cachedIds.value = new Set(cachedIds.value).add(bookmark.id);
      }
      return;
    }

    const urls = extractImageUrls(bookmark.content_md, bookmark.thumbnail_url);
    const images = (
      await Promise.all(
        urls.map(async (url) => {
          try {
            const blob = await fetch(url).then((response) => response.blob());
            return { url, blob };
          } catch {
            return null;
          }
        }),
      )
    ).filter((image): image is { url: string; blob: Blob } => image !== null);

    await offlineDb.putArticle({
      id: bookmark.id,
      content_md: bookmark.content_md,
      images,
      cachedAt: new Date().toISOString(),
    });
    cachedIds.value = new Set(cachedIds.value).add(bookmark.id);
  }

  async function removeCachedBookmark(id: string): Promise<void> {
    await offlineDb.deleteArticle(id);
    const next = new Set(cachedIds.value);
    next.delete(id);
    cachedIds.value = next;
  }

  return { cachedIds, init, isCached, cacheBookmark, removeCachedBookmark };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useOfflineCacheStore, import.meta.hot));
}
