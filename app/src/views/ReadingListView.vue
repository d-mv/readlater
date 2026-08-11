<script lang="ts">
let savedScrollPosition = 0;
</script>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { IconSettings } from "@tabler/icons-vue";
import { useBookmarksStore } from "../stores/bookmarks";
import { useOfflineCacheStore } from "../stores/offlineCache";
import { useDebouncedFn } from "../composables/useDebouncedFn";
import StatusTabs from "../components/list/StatusTabs.vue";
import BookmarkList from "../components/list/BookmarkList.vue";
import AddBookmarkDialog from "../components/list/AddBookmarkDialog.vue";
import TagFilterBar from "../components/list/TagFilterBar.vue";
import ThemeToggle from "../components/ThemeToggle.vue";
import type { BookmarkFilter } from "../stores/bookmarks";

const router = useRouter();
const store = useBookmarksStore();
const offlineCache = useOfflineCacheStore();

function onScroll() {
  savedScrollPosition =
    window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
}

onMounted(() => {
  store.fetch();
  store.startPolling();
  offlineCache.init();
  window.addEventListener("scroll", onScroll, { passive: true });
  if (savedScrollPosition > 0) {
    window.scrollTo(0, savedScrollPosition);
  }
});

onUnmounted(() => {
  store.stopPolling();
  window.removeEventListener("scroll", onScroll);
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
const runSearch = useDebouncedFn((query: string) => {
  store.setSearchQuery(query);
  store.fetch();
}, 300);

function onSearchInput() {
  savedScrollPosition = 0;
  window.scrollTo(0, 0);
  runSearch(searchInput.value);
}

function onToggleTag(tagId: string) {
  savedScrollPosition = 0;
  window.scrollTo(0, 0);
  const next = store.activeTagIds.includes(tagId)
    ? store.activeTagIds.filter((id) => id !== tagId)
    : [...store.activeTagIds, tagId];
  store.setActiveTagIds(next);
  store.fetch();
}
</script>

<template>
  <main class="list-view">
    <div class="title-row">
      <h1 class="app-title">Read Later</h1>
      <div class="title-actions">
        <AddBookmarkDialog />
        <button
          class="icon-btn"
          type="button"
          aria-label="Settings"
          @click="router.push({ name: 'settings' })"
        >
          <IconSettings :size="18" />
        </button>
        <ThemeToggle />
      </div>
    </div>
    <input
      v-model="searchInput"
      class="search-input"
      type="search"
      placeholder="Search…"
      maxlength="200"
      @input="onSearchInput"
    />
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
  </main>
</template>

<style scoped>
.list-view {
  max-width: 640px;
  margin: 0 auto;
  min-height: 100vh;
  background: var(--rl-bg);
}

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 4px;
}

.app-title {
  font-size: 16px;
  font-weight: 500;
  color: var(--rl-text-primary);
  margin: 0;
}

.title-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.icon-btn {
  display: inline-flex;
  border: none;
  background: transparent;
  color: var(--rl-text-secondary);
  cursor: pointer;
  padding: 0;
}

.search-input {
  display: block;
  width: calc(100% - 32px);
  margin: 4px 16px;
  height: 34px;
  padding: 0 12px;
  border-radius: var(--rl-radius);
  border: 0.5px solid var(--rl-border);
  background: transparent;
  color: var(--rl-text-primary);
  font-size: 14px;
}

.search-input:focus {
  outline: none;
  border-color: var(--rl-accent);
}
</style>
