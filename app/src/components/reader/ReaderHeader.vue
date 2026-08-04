<script setup lang="ts">
import { computed } from "vue";
import { IconChevronLeft } from "@tabler/icons-vue";
import type { Bookmark } from "../../lib/supabase";
import { domainFromUrl } from "../../utils/format";
import ReaderMenu from "./ReaderMenu.vue";

const props = defineProps<{
  bookmark: Bookmark;
}>();

const emit = defineEmits<{
  back: [];
  archive: [];
  delete: [];
  share: [];
  markRead: [];
  markUnread: [];
  edit: [];
  translate: [];
  openOriginalPdf: [];
  trashOriginalPdf: [];
}>();

const domain = computed(() => domainFromUrl(props.bookmark.url));
</script>

<template>
  <div class="header">
    <button class="icon-btn back-btn" type="button" @click="emit('back')">
      <IconChevronLeft :size="20" />
    </button>
    <span class="domain">{{ domain }}</span>
    <ReaderMenu
      :bookmark="bookmark"
      @archive="emit('archive')"
      @delete="emit('delete')"
      @share="emit('share')"
      @mark-read="emit('markRead')"
      @mark-unread="emit('markUnread')"
      @edit="emit('edit')"
      @translate="emit('translate')"
      @open-original-pdf="emit('openOriginalPdf')"
      @trash-original-pdf="emit('trashOriginalPdf')"
    />
  </div>
</template>

<style scoped>
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 0.5px solid var(--rl-border);
}

.domain {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--rl-font-mono);
  font-size: 12px;
  color: var(--rl-text-muted);
}

.icon-btn {
  display: inline-flex;
  border: none;
  background: transparent;
  color: var(--rl-text-secondary);
  cursor: pointer;
  padding: 0;
}
</style>
