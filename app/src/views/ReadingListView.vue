<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { useBookmarksStore } from "../stores/bookmarks";
import { useOfflineCacheStore } from "../stores/offlineCache";
import StatusTabs from "../components/list/StatusTabs.vue";
import BookmarkList from "../components/list/BookmarkList.vue";
import AddBookmarkDialog from "../components/list/AddBookmarkDialog.vue";
import ThemeToggle from "../components/ThemeToggle.vue";
import type { BookmarkFilter } from "../stores/bookmarks";

const router = useRouter();
const store = useBookmarksStore();
const offlineCache = useOfflineCacheStore();

onMounted(() => {
  store.fetch();
  offlineCache.init();
});

function onOpen(id: string) {
  router.push({ name: "reader", params: { id } });
}

function onChangeFilter(filter: BookmarkFilter) {
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
</script>

<template>
  <main class="list-view">
    <div class="title-row">
      <h1 class="app-title">Read Later</h1>
      <div class="title-actions">
        <AddBookmarkDialog />
        <ThemeToggle />
      </div>
    </div>
    <StatusTabs :active-filter="store.filter" :unread-count="store.unreadCount" @change="onChangeFilter" />
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
</style>
