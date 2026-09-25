<script lang="ts">
let savedScrollPosition = 0;
</script>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, useTemplateRef, watch } from "vue";
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
import type { BookmarkFilter } from "../stores/bookmarks";

const router = useRouter();
const store = useBookmarksStore();
const offlineCache = useOfflineCacheStore();

function onScroll() {
  savedScrollPosition =
    window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
}

const loadMoreSentinel = useTemplateRef<HTMLDivElement>("loadMoreSentinel");
let observer: IntersectionObserver | undefined;

onMounted(() => {
  store.fetch();
  // Live list updates via one Realtime subscription instead of a REST poll.
  store.subscribeToChanges();
  offlineCache.init();
  window.addEventListener("scroll", onScroll, { passive: true });
  if (typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) store.loadMore();
      },
      { rootMargin: "600px" },
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

function onToggleOffline(id: string) {
  const bookmark = store.bookmarks.find((b) => b.id === id);
  if (!bookmark) return;
  if (offlineCache.isCached(id)) {
    offlineCache.removeCachedBookmark(id);
  } else {
    offlineCache.cacheBookmark(bookmark);
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
  <main class="mx-auto min-h-screen max-w-640 bg-canvas">
    <div class="flex items-center justify-between px-16 pt-16 pb-4">
      <h1 class="m-0 text-md font-medium text-ink">Read Later</h1>
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
        class="mx-16 my-4 block h-34 w-[calc(100%-32px)] bg-transparent focus:border-accent focus:outline-none"
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
      @open="onOpen"
      @toggle-offline="onToggleOffline"
    />
    <div
      v-if="store.hasMore && store.visibleBookmarks.length > 0"
      ref="loadMoreSentinel"
      class="min-h-px p-16 text-center"
    >
      <span v-if="store.loadingMore" class="text-xs text-ink-faint">Loading more…</span>
    </div>
  </main>
</template>
