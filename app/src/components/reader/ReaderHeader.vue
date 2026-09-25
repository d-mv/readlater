<script setup lang="ts">
import { computed } from "vue";
import { IconChevronLeft } from "@tabler/icons-vue";
import type { Bookmark } from "../../lib/supabase";
import { domainFromUrl } from "../../utils/format";
import ReaderMenu from "./ReaderMenu.vue";
import IconButton from "../../shared/ui/IconButton.vue";

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
  <div class="flex items-center justify-between border-b-[0.5px] border-line px-16 py-12">
    <IconButton title="Back" test-id="back-btn" @click="emit('back')">
      <IconChevronLeft :size="20" />
    </IconButton>
    <span class="min-w-0 truncate font-mono text-xs text-ink-faint">{{ domain }}</span>
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
