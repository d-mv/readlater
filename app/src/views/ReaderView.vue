<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import { IconLoader2, IconAlertTriangle } from "@tabler/icons-vue";
import { useBookmarksStore } from "../stores/bookmarks";
import { useOfflineCacheStore } from "../stores/offlineCache";
import { useScrollProgress } from "../composables/useScrollProgress";
import { readerByline } from "../utils/format";
import ReaderHeader from "../components/reader/ReaderHeader.vue";
import ReaderProgressBar from "../components/reader/ReaderProgressBar.vue";
import ArticleContent from "../components/reader/ArticleContent.vue";
import ReaderActions from "../components/reader/ReaderActions.vue";
import ShareDialog from "../components/reader/ShareDialog.vue";
import TagInput from "../components/reader/TagInput.vue";

const POLL_INTERVAL_MS = 3000;

const props = defineProps<{
  id: string;
}>();

const router = useRouter();
const store = useBookmarksStore();
const offlineCache = useOfflineCacheStore();

const bookmark = computed(() => store.bookmarks.find((b) => b.id === props.id) ?? null);
const byline = computed(() => (bookmark.value ? readerByline(bookmark.value) : ""));
const isNotReady = computed(
  () => bookmark.value !== null && bookmark.value.status !== "ready" && bookmark.value.status !== "failed",
);

const scrollContainer = useTemplateRef<HTMLDivElement>("scrollContainer");
const { progress } = useScrollProgress(scrollContainer);

let pollTimer: ReturnType<typeof setInterval> | undefined;

function stopPolling() {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

onMounted(async () => {
  if (!bookmark.value) await store.fetchOne(props.id);
  if (bookmark.value?.status === "ready") {
    offlineCache.cacheBookmark(bookmark.value).catch(() => {});
  }
  if (isNotReady.value) {
    pollTimer = setInterval(async () => {
      await store.fetchOne(props.id);
      if (!isNotReady.value) stopPolling();
    }, POLL_INTERVAL_MS);
  }
});

onUnmounted(stopPolling);

function onBack() {
  router.push({ name: "list" });
}

async function onArchive() {
  await store.archive(props.id);
  router.push({ name: "list" });
}

async function onDelete() {
  await store.remove(props.id);
  router.push({ name: "list" });
}

function onMarkRead() {
  store.markRead(props.id);
}

function onMarkUnread() {
  store.markUnread(props.id);
}

const showShareDialog = ref(false);

function onTogglePublic(isPublic: boolean) {
  if (bookmark.value) store.setPublic(bookmark.value.id, isPublic);
}

function onAddTag(name: string) {
  if (bookmark.value) store.addTag(bookmark.value.id, name);
}

function onRemoveTag(tagId: string) {
  if (bookmark.value) store.removeTag(bookmark.value.id, tagId);
}
</script>

<template>
  <main v-if="bookmark" class="reader-view">
    <ReaderProgressBar :progress="progress" />
    <ReaderHeader
      :bookmark="bookmark"
      @back="onBack"
      @archive="onArchive"
      @delete="onDelete"
      @share="showShareDialog = true"
    />
    <div ref="scrollContainer" class="scroll-area">
      <template v-if="bookmark.status === 'ready'">
        <h1 class="title">{{ bookmark.title }}</h1>
        <p v-if="byline" class="byline">{{ byline }}</p>
        <ArticleContent :content-md="bookmark.content_md" />
      </template>
      <div v-else-if="bookmark.status === 'failed'" class="status-placeholder">
        <IconAlertTriangle :size="28" class="status-icon status-icon-failed" />
        <p class="status-text">Couldn't process this article.</p>
        <p v-if="bookmark.error_message" class="status-detail">{{ bookmark.error_message }}</p>
      </div>
      <div v-else class="status-placeholder">
        <IconLoader2 :size="28" class="status-icon icon-spin" />
        <p class="status-text">Processing…</p>
      </div>
    </div>
    <TagInput v-if="bookmark.status === 'ready'" :tags="bookmark.tags" @add="onAddTag" @remove="onRemoveTag" />
    <ReaderActions :bookmark="bookmark" @mark-read="onMarkRead" @mark-unread="onMarkUnread" />
    <ShareDialog
      v-if="showShareDialog"
      :bookmark="bookmark"
      @close="showShareDialog = false"
      @toggle-public="onTogglePublic"
    />
  </main>
</template>

<style scoped>
.reader-view {
  max-width: 680px;
  margin: 0 auto;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--rl-surface);
}

.scroll-area {
  flex: 1;
  overflow-y: auto;
  padding: 20px 20px 8px;
}

.title {
  font-family: var(--rl-font-ui);
  font-size: 20px;
  font-weight: 500;
  color: var(--rl-text-primary);
  line-height: 1.3;
  margin: 0 0 8px;
}

.byline {
  font-family: var(--rl-font-mono);
  font-size: 12px;
  color: var(--rl-text-muted);
  margin: 0 0 20px;
}

.status-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 64px 16px;
  text-align: center;
  color: var(--rl-text-muted);
}

.status-icon-failed {
  color: var(--rl-danger);
}

.status-text {
  font-family: var(--rl-font-ui);
  font-size: 14px;
  margin: 0;
}

.status-detail {
  font-family: var(--rl-font-mono);
  font-size: 12px;
  color: var(--rl-text-muted);
  margin: 0;
  max-width: 480px;
}

.icon-spin {
  animation: rl-spin 1s linear infinite;
}

@keyframes rl-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
