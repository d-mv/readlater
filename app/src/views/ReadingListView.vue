<script lang="ts">
let savedScrollPosition = 0;
</script>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from "vue";
import { useRouter } from "vue-router";
import { IconSettings } from "@tabler/icons-vue";
import { useBookmarksStore } from "../stores/bookmarks";
import { useOfflineCacheStore } from "../stores/offlineCache";
import StatusTabs from "../components/list/StatusTabs.vue";
import BookmarkList from "../components/list/BookmarkList.vue";
import AddBookmarkDialog from "../components/list/AddBookmarkDialog.vue";
import TagFilterBar from "../components/list/TagFilterBar.vue";
import ThemeToggle from "../components/ThemeToggle.vue";
import IconButton from "../shared/ui/IconButton.vue";
import Input from "../shared/ui/Input.vue";
import Button from "../shared/ui/Button.vue";
import type { BookmarkFilter } from "../stores/bookmarks";

const router = useRouter();
const store = useBookmarksStore();
const offlineCache = useOfflineCacheStore();

function onScroll() {
  savedScrollPosition =
    window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
}

// How far below the viewport the next page starts loading.
const LOAD_AHEAD_PX = 600;
// Coming back to the app refetches at most this often (see onVisibilityChange).
const VISIBLE_REFETCH_INTERVAL_MS = 30_000;

const loadMoreSentinel = useTemplateRef<HTMLDivElement>("loadMoreSentinel");
let observer: IntersectionObserver | undefined;
let pagingIn = false;

function sentinelInRange(): boolean {
  const el = loadMoreSentinel.value;
  return !!el && el.getBoundingClientRect().top <= window.innerHeight + LOAD_AHEAD_PX;
}

// The observer only fires when the sentinel's visibility *changes*. On a
// sparse tab (Archive, or a tag filter) a page can add no visible rows, so the
// sentinel never leaves the viewport and no further event comes — keep paging
// until it's pushed out of range or the list runs out.
async function loadMoreWhileInRange() {
  if (pagingIn) return;
  pagingIn = true;
  try {
    while (store.hasMore && sentinelInRange()) {
      const loaded = store.bookmarks.length;
      await store.loadMore();
      await nextTick();
      // Nothing arrived (a failed or already in-flight page): stop rather
      // than spin; scrolling or the Load more button retries.
      if (store.bookmarks.length === loaded) break;
    }
  } finally {
    pagingIn = false;
  }
}

function onOnline() {
  store.fetch();
  store.subscribeToChanges();
}

// iOS suspends a backgrounded PWA and its Realtime socket with it, so changes
// made meanwhile (a capture from the Shortcut, the worker finishing a parse)
// never arrive. Catch up when the app comes back — a cheap delta sync, but
// throttled since app switching can toggle visibility in quick succession.
let lastVisibleRefetch = Date.now();

function onVisibilityChange() {
  if (document.visibilityState !== "visible") return;
  if (Date.now() - lastVisibleRefetch < VISIBLE_REFETCH_INTERVAL_MS) return;
  lastVisibleRefetch = Date.now();
  store.fetch();
}

onMounted(() => {
  store.fetch();
  // Live list updates via one Realtime subscription instead of a REST poll.
  store.subscribeToChanges();
  offlineCache.init();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisibilityChange);
  if (typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMoreWhileInRange();
      },
      { rootMargin: `${LOAD_AHEAD_PX}px` },
    );
    if (loadMoreSentinel.value) observer.observe(loadMoreSentinel.value);
  }
  if (savedScrollPosition > 0) {
    window.scrollTo(0, savedScrollPosition);
  }
});

// The sentinel is v-if'd on hasMore, so it appears only after the first page
// resolves — (re)observe it whenever it mounts.
watch(loadMoreSentinel, (el) => {
  if (!observer) return;
  observer.disconnect();
  if (el) observer.observe(el);
});

onUnmounted(() => {
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("online", onOnline);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  observer?.disconnect();
});

function onOpen(id: string) {
  router.push({ name: "reader", params: { id } });
}

function onChangeFilter(filter: BookmarkFilter) {
  savedScrollPosition = 0;
  window.scrollTo(0, 0);
  store.setFilter(filter);
}

async function onToggleOffline(id: string) {
  const bookmark = store.bookmarks.find((b) => b.id === id);
  if (!bookmark) return;
  if (offlineCache.isCached(id)) {
    offlineCache.removeCachedBookmark(id);
  } else {
    let fullBookmark = bookmark;
    if (fullBookmark.content_md === undefined) {
      const loaded = await store.fetchOne(id);
      if (loaded) fullBookmark = loaded;
    }
    offlineCache.cacheBookmark(fullBookmark);
  }
}

const searchInput = ref("");

// Full-text search runs against Postgres, so it costs a query — fire it only
// on submit (Enter), not on every keystroke. Clearing the box restores the
// full list immediately.
function onSearchSubmit() {
  savedScrollPosition = 0;
  window.scrollTo(0, 0);
  store.setSearchQuery(searchInput.value.trim());
  store.fetch();
}

function onSearchInput() {
  savedScrollPosition = 0;
  window.scrollTo(0, 0);
  if (searchInput.value.trim() === "" && store.searchQuery !== "") {
    store.setSearchQuery("");
    store.fetch();
  }
}

// Tag filtering is resolved client-side against the loaded list — no query.
function onToggleTag(tagId: string) {
  savedScrollPosition = 0;
  window.scrollTo(0, 0);
  const next = store.activeTagIds.includes(tagId)
    ? store.activeTagIds.filter((id) => id !== tagId)
    : [...store.activeTagIds, tagId];
  store.setActiveTagIds(next);
}
</script>

<template>
  <main class="mx-auto min-h-screen max-w-640 bg-canvas sm:border-x sm:border-line">
    <div class="flex items-center justify-between px-16 pt-16 pb-4">
      <h1 class="m-0 font-sans text-md font-medium tracking-tight text-ink">Read Later</h1>
      <div class="flex items-center gap-12">
        <AddBookmarkDialog />
        <IconButton title="Settings" @click="router.push({ name: 'settings' })">
          <IconSettings :size="18" />
        </IconButton>
        <ThemeToggle />
      </div>
    </div>
    <form data-testid="search-form" class="contents" @submit.prevent="onSearchSubmit">
      <Input
        v-model="searchInput"
        test-id="search-input"
        type="search"
        placeholder="Search…"
        :maxlength="200"
        class="mx-16 my-8 block h-34 w-[calc(100%-32px)] bg-recessed"
        @update:model-value="onSearchInput"
      />
    </form>
    <TagFilterBar
      :tags="store.allTags"
      :active-tag-ids="store.activeTagIds"
      @toggle="onToggleTag"
    />
    <StatusTabs
      :active-filter="store.filter"
      :unread-count="store.unreadCount"
      @change="onChangeFilter"
    />
    <BookmarkList
      :bookmarks="store.visibleBookmarks"
      :cached-ids="offlineCache.cachedIds"
      :missing-image-counts="offlineCache.missingImageCounts"
      @open="onOpen"
      @toggle-offline="onToggleOffline"
    />
    <!-- Rendered whenever older pages exist, even if this tab shows nothing
         yet: an empty Archive tab still has to page further back. The button
         is the fallback where scrolling can't trigger the observer. -->
    <div v-if="store.hasMore" ref="loadMoreSentinel" class="min-h-px p-16 text-center">
      <span v-if="store.loadingMore" class="text-xs text-ink-faint">Loading more…</span>
      <Button v-else variant="secondary" test-id="load-more" @click="loadMoreWhileInRange">
        Load more
      </Button>
    </div>
  </main>
</template>
