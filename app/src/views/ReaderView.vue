<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import { IconLoader2, IconAlertTriangle, IconRefresh } from "@tabler/icons-vue";
import { useBookmarksStore } from "../stores/bookmarks";
import { useOfflineCacheStore } from "../stores/offlineCache";
import { useScrollProgress } from "../composables/useScrollProgress";
import { readerByline } from "../utils/format";
import { readingTimeFromWordCount, wordCount } from "../utils/reading";
import ReaderHeader from "../components/reader/ReaderHeader.vue";
import ReaderProgressBar from "../components/reader/ReaderProgressBar.vue";
import ArticleContent from "../components/reader/ArticleContent.vue";
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
  () =>
    bookmark.value !== null &&
    bookmark.value.status !== "ready" &&
    bookmark.value.status !== "failed",
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

function startPolling() {
  if (pollTimer !== undefined) return;
  pollTimer = setInterval(async () => {
    await store.fetchOne(props.id);
    if (!isNotReady.value) stopPolling();
  }, POLL_INTERVAL_MS);
}

onMounted(async () => {
  if (!bookmark.value) await store.fetchOne(props.id);
  if (bookmark.value?.status === "ready") {
    offlineCache.cacheBookmark(bookmark.value).catch(() => {});
  }
  if (isNotReady.value) startPolling();
});

async function onRetry() {
  await store.refresh(props.id);
  startPolling();
}

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

const editing = ref(false);
const draftTitle = ref("");
const draftContent = ref("");

function onEdit() {
  if (!bookmark.value) return;
  draftTitle.value = bookmark.value.title ?? "";
  draftContent.value = bookmark.value.content_md ?? "";
  editing.value = true;
}

function onCancelEdit() {
  editing.value = false;
}

async function onSaveEdit() {
  if (!bookmark.value) return;
  const words = wordCount(draftContent.value);
  await store.updateContent(bookmark.value.id, {
    title: draftTitle.value,
    content_md: draftContent.value,
    word_count: words,
    reading_time: readingTimeFromWordCount(words),
  });
  editing.value = false;
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
      @mark-read="onMarkRead"
      @mark-unread="onMarkUnread"
      @edit="onEdit"
    />
    <div ref="scrollContainer" class="scroll-area">
      <template v-if="bookmark.status === 'ready'">
        <h1 v-if="!editing" class="title">{{ bookmark.title }}</h1>
        <input v-else v-model="draftTitle" class="title-input" type="text" placeholder="Title" />
        <p v-if="byline && !editing" class="byline">{{ byline }}</p>
        <div v-if="editing" class="edit-actions">
          <button class="btn-secondary cancel-edit-btn" type="button" @click="onCancelEdit">
            Cancel
          </button>
          <button class="btn-primary save-edit-btn" type="button" @click="onSaveEdit">Save</button>
        </div>
        <ArticleContent
          :content-md="bookmark.content_md"
          :type="bookmark.type"
          :youtube-video-id="bookmark.youtube_video_id"
          :thumbnail-url="bookmark.thumbnail_url"
          :editing="editing"
          :model-value="draftContent"
          @update:model-value="draftContent = $event"
        />
      </template>
      <div v-else-if="bookmark.status === 'failed'" class="status-placeholder">
        <IconAlertTriangle :size="28" class="status-icon status-icon-failed" />
        <p class="status-text">Couldn't process this article.</p>
        <p v-if="bookmark.error_message" class="status-detail">{{ bookmark.error_message }}</p>
        <button class="retry-btn" type="button" @click="onRetry">
          <IconRefresh :size="16" />
          Try again
        </button>
      </div>
      <div v-else class="status-placeholder">
        <IconLoader2 :size="28" class="status-icon icon-spin" />
        <p class="status-text">Processing…</p>
      </div>
    </div>
    <TagInput
      v-if="bookmark.status === 'ready'"
      :tags="bookmark.tags"
      @add="onAddTag"
      @remove="onRemoveTag"
    />
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

.title-input {
  width: 100%;
  border: 0.5px solid var(--rl-border);
  border-radius: var(--rl-radius);
  background: var(--rl-surface);
  color: var(--rl-text-primary);
  font-family: var(--rl-font-ui);
  font-size: 20px;
  font-weight: 500;
  padding: 8px 10px;
  margin: 0 0 12px;
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin: 0 0 12px;
}

.btn-secondary,
.btn-primary {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 14px;
  border-radius: var(--rl-radius);
  font-family: var(--rl-font-ui);
  font-size: 13px;
  cursor: pointer;
  border: none;
}

.btn-secondary {
  background: transparent;
  border: 0.5px solid var(--rl-border);
  color: var(--rl-text-primary);
}

.btn-primary {
  background: var(--rl-accent);
  color: var(--rl-on-accent);
  font-weight: 500;
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

.retry-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 8px 14px;
  border: 0.5px solid var(--rl-border);
  border-radius: var(--rl-radius);
  background: var(--rl-surface);
  color: var(--rl-text-primary);
  font-family: var(--rl-font-ui);
  font-size: 13px;
  cursor: pointer;
}

.retry-btn:hover {
  background: var(--rl-bg);
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
