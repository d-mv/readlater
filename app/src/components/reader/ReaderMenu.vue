<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from "vue";
import {
  IconArchive,
  IconDotsVertical,
  IconExternalLink,
  IconMail,
  IconMailOpened,
  IconTrash,
  IconWorld,
} from "@tabler/icons-vue";
import type { Bookmark } from "../../lib/supabase";
import FontSizeControl from "./FontSizeControl.vue";

const props = defineProps<{
  bookmark: Bookmark;
}>();

const emit = defineEmits<{
  archive: [];
  delete: [];
  share: [];
  markRead: [];
  markUnread: [];
}>();

const canMarkRead = computed(() => props.bookmark.status === "ready" && props.bookmark.read_at === null);
const canMarkUnread = computed(() => props.bookmark.status === "ready" && props.bookmark.read_at !== null);

const open = ref(false);
const menuRef = useTemplateRef<HTMLDivElement>("menuRef");

function toggle() {
  open.value = !open.value;
}

function close() {
  open.value = false;
}

function select(action: () => void) {
  action();
  close();
}

function onDelete() {
  if (window.confirm("Delete this article? This can't be undone.")) {
    emit("delete");
  }
  close();
}

function onClickOutside(event: MouseEvent) {
  if (open.value && menuRef.value && !menuRef.value.contains(event.target as Node)) close();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}

onMounted(() => {
  document.addEventListener("click", onClickOutside);
  document.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  document.removeEventListener("click", onClickOutside);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div ref="menuRef" class="reader-menu">
    <button
      class="icon-btn menu-trigger"
      type="button"
      aria-haspopup="true"
      :aria-expanded="open"
      aria-label="Article actions"
      @click="toggle"
    >
      <IconDotsVertical :size="20" />
    </button>
    <div v-if="open" class="menu-panel" role="menu">
      <div class="menu-row font-size-row">
        <span class="menu-label">Font size</span>
        <FontSizeControl />
      </div>
      <a
        v-if="bookmark.url"
        class="menu-item open-original"
        :href="bookmark.url"
        target="_blank"
        rel="noopener"
        role="menuitem"
        @click="close"
      >
        <IconExternalLink :size="16" />
        Open original
      </a>
      <button
        v-if="canMarkRead"
        class="menu-item mark-read"
        type="button"
        role="menuitem"
        @click="select(() => emit('markRead'))"
      >
        <IconMailOpened :size="16" />
        Mark as read
      </button>
      <button
        v-if="canMarkUnread"
        class="menu-item mark-unread"
        type="button"
        role="menuitem"
        @click="select(() => emit('markUnread'))"
      >
        <IconMail :size="16" />
        Mark as unread
      </button>
      <button
        class="menu-item share-item"
        :class="{ 'share-item-active': bookmark.is_public }"
        type="button"
        role="menuitem"
        @click="select(() => emit('share'))"
      >
        <IconWorld :size="16" />
        Share…
      </button>
      <button class="menu-item archive-item" type="button" role="menuitem" @click="select(() => emit('archive'))">
        <IconArchive :size="16" />
        Archive
      </button>
      <button class="menu-item delete-item menu-item-danger" type="button" role="menuitem" @click="onDelete">
        <IconTrash :size="16" />
        Delete
      </button>
    </div>
  </div>
</template>

<style scoped>
.reader-menu {
  position: relative;
}

.icon-btn {
  display: inline-flex;
  border: none;
  background: transparent;
  color: var(--rl-text-secondary);
  cursor: pointer;
  padding: 0;
}

.menu-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  min-width: 200px;
  padding: 6px;
  background: var(--rl-surface);
  border: 0.5px solid var(--rl-border);
  border-radius: var(--rl-radius);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
}

.menu-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
}

.menu-label {
  font-family: var(--rl-font-ui);
  font-size: 13px;
  color: var(--rl-text-secondary);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  border: none;
  background: transparent;
  border-radius: calc(var(--rl-radius) - 2px);
  padding: 8px 10px;
  font-family: var(--rl-font-ui);
  font-size: 13px;
  color: var(--rl-text-primary);
  text-decoration: none;
  cursor: pointer;
  text-align: left;
}

.menu-item:hover {
  background: var(--rl-bg);
}

.share-item-active {
  color: var(--rl-accent);
}

.menu-item-danger {
  color: var(--rl-danger);
}
</style>
