<script setup lang="ts">
import { computed } from "vue";
import {
  IconFileText,
  IconBrandYoutube,
  IconLoader2,
  IconAlertTriangle,
  IconDownload,
  IconCheck,
  IconWorld,
  IconLanguageHiragana,
} from "@tabler/icons-vue";
import type { Bookmark } from "../../lib/supabase";
import { listRowMeta } from "../../utils/format";

const props = withDefaults(
  defineProps<{
    bookmark: Bookmark;
    isCached?: boolean;
  }>(),
  { isCached: false },
);

const emit = defineEmits<{
  open: [id: string];
  toggleOffline: [id: string];
}>();

const iconComponent = computed(() =>
  props.bookmark.type === "youtube" ? IconBrandYoutube : IconFileText,
);
const meta = computed(() => listRowMeta(props.bookmark));
const isRead = computed(() => props.bookmark.read_at !== null);
const isPending = computed(
  () => props.bookmark.status === "pending" || props.bookmark.status === "processing",
);
const isFailed = computed(() => props.bookmark.status === "failed");
const isUnread = computed(() => !props.bookmark.archived && !isRead.value);
const isTranslated = computed(() => props.bookmark.translated_content_md !== null);
const displayTitle = computed(() => {
  if (props.bookmark.title) return props.bookmark.title;
  if (isFailed.value) return "Failed to process";
  if (isPending.value) return "Processing…";
  return props.bookmark.url ?? "Note";
});
</script>

<template>
  <div class="row">
    <button class="row-main" type="button" @click="emit('open', bookmark.id)">
      <span class="icon-box">
        <IconLoader2 v-if="isPending" :size="16" class="icon icon-spin" />
        <IconAlertTriangle v-else-if="isFailed" :size="16" class="icon icon-failed" />
        <component :is="iconComponent" v-else :size="16" class="icon" />
      </span>
      <span class="text">
        <span class="title-row">
          <span
            class="title"
            :class="{ 'title-read': isRead, 'title-pending': isPending, 'title-failed': isFailed }"
            >{{ displayTitle }}</span
          >
          <IconWorld
            v-if="bookmark.is_public"
            :size="12"
            class="public-badge"
            aria-label="Shared publicly"
          />
        </span>
        <span class="meta-row">
          <span class="meta">{{ meta }}</span>
          <IconLanguageHiragana
            v-if="isTranslated"
            :size="12"
            class="translated-badge"
            aria-label="Translated"
          />
        </span>
      </span>
    </button>
    <button
      v-if="isUnread"
      class="offline-toggle"
      :class="{ 'offline-toggle-cached': isCached }"
      type="button"
      :aria-label="isCached ? 'Remove offline copy' : 'Save offline'"
      @click="emit('toggleOffline', bookmark.id)"
    >
      <IconCheck v-if="isCached" :size="16" />
      <IconDownload v-else :size="16" />
    </button>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 0 16px;
  border-top: 0.5px solid var(--rl-border);
}

.row-main {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  padding: 14px 0;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
}

.offline-toggle {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--rl-text-muted);
  cursor: pointer;
}

.offline-toggle-cached {
  color: var(--rl-accent);
}

.icon-box {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: var(--rl-surface);
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon {
  color: var(--rl-text-secondary);
}

.text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.title {
  font-size: 14px;
  font-weight: 500;
  color: var(--rl-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.public-badge {
  flex-shrink: 0;
  color: var(--rl-accent);
}

.title-read {
  font-weight: 400;
  color: var(--rl-text-muted);
}

.title-pending {
  font-style: italic;
  color: var(--rl-text-muted);
}

.title-failed {
  color: var(--rl-danger);
}

.icon-failed {
  color: var(--rl-danger);
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

.meta-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  margin-top: 4px;
}

.meta {
  font-size: 12px;
  color: var(--rl-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.translated-badge {
  flex-shrink: 0;
  color: var(--rl-text-muted);
}
</style>
