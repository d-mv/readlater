<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from "vue";
import {
  IconArchive,
  IconDotsVertical,
  IconExternalLink,
  IconLanguage,
  IconMail,
  IconMailOpened,
  IconPencil,
  IconTrash,
  IconWorld,
} from "@tabler/icons-vue";
import type { Bookmark } from "../../lib/supabase";
import FontSizeControl from "./FontSizeControl.vue";
import { cn } from "../../shared/clsx";

const ITEM =
  "flex items-center gap-10 rounded-sm border-0 bg-transparent px-10 py-8 text-left font-sans text-sm text-ink no-underline cursor-pointer hover:bg-canvas";

const props = defineProps<{
  bookmark: Bookmark;
}>();

const emit = defineEmits<{
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

const canMarkRead = computed(
  () => props.bookmark.status === "ready" && props.bookmark.read_at === null,
);
const canMarkUnread = computed(
  () => props.bookmark.status === "ready" && props.bookmark.read_at !== null,
);

// Anything with a body is translated in-app (DeepL via the translate edge
// function, cached on the row). Bookmarks with a URL additionally offer
// Google Translate's page proxy, which translates the live page instead.
const translatePageUrl = computed(() => {
  if (!props.bookmark.url) return null;
  const targetLang = navigator.language.split("-")[0] || "en";
  return `https://translate.google.com/translate?sl=auto&tl=${targetLang}&u=${encodeURIComponent(props.bookmark.url)}`;
});

const canTranslateInline = computed(() => !!props.bookmark.content_md);

// A PDF has no source URL — its "original" is the uploaded file kept in
// Storage, opened via a signed url the parent resolves on click.
const canOpenOriginalPdf = computed(
  () => props.bookmark.type === "pdf" && !!props.bookmark.pdf_path,
);
// Only offered once parsing succeeded, since content_md then stands on its
// own — trashing the original of an unparsed PDF would leave nothing to read.
const canTrashOriginalPdf = computed(
  () => props.bookmark.type === "pdf" && !!props.bookmark.pdf_path && props.bookmark.pdf_parsed,
);

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

function onTrashOriginalPdf() {
  if (window.confirm("Delete the original PDF? This can't be undone.")) {
    emit("trashOriginalPdf");
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
  <div ref="menuRef" class="relative">
    <button
      data-testid="menu-trigger"
      class="inline-flex cursor-pointer border-0 bg-transparent p-0 text-ink-muted"
      type="button"
      aria-haspopup="true"
      :aria-expanded="open"
      aria-label="Article actions"
      @click="toggle"
    >
      <IconDotsVertical :size="20" />
    </button>
    <div
      v-if="open"
      data-testid="menu-panel"
      class="absolute top-[calc(100%+8px)] right-0 z-50 flex min-w-200 flex-col rounded-md border-[0.5px] border-line bg-raised p-6 shadow-[0_8px_24px_rgba(0,0,0,0.16)]"
      role="menu"
    >
      <div class="flex items-center justify-between px-10 py-8">
        <span class="font-sans text-sm text-ink-muted">Font size</span>
        <FontSizeControl />
      </div>
      <a
        data-testid="open-original"
        v-if="bookmark.url"
        :class="ITEM"
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
        data-testid="open-original"
        v-else-if="canOpenOriginalPdf"
        :class="ITEM"
        type="button"
        role="menuitem"
        @click="select(() => emit('openOriginalPdf'))"
      >
        <IconExternalLink :size="16" />
        Open original
      </button>
      <button
        data-testid="translate-item"
        v-if="canTranslateInline"
        :class="ITEM"
        type="button"
        role="menuitem"
        @click="select(() => emit('translate'))"
      >
        <IconLanguage :size="16" />
        Translate…
      </button>
      <a
        data-testid="translate-page-item"
        v-if="translatePageUrl"
        :class="ITEM"
        :href="translatePageUrl"
        target="_blank"
        rel="noopener"
        role="menuitem"
        @click="close"
      >
        <IconLanguage :size="16" />
        Translate page
      </a>
      <button
        data-testid="edit-item"
        :class="ITEM"
        type="button"
        role="menuitem"
        @click="select(() => emit('edit'))"
      >
        <IconPencil :size="16" />
        Edit
      </button>
      <button
        data-testid="mark-read"
        v-if="canMarkRead"
        :class="ITEM"
        type="button"
        role="menuitem"
        @click="select(() => emit('markRead'))"
      >
        <IconMailOpened :size="16" />
        Mark as read
      </button>
      <button
        data-testid="mark-unread"
        v-if="canMarkUnread"
        :class="ITEM"
        type="button"
        role="menuitem"
        @click="select(() => emit('markUnread'))"
      >
        <IconMail :size="16" />
        Mark as unread
      </button>
      <button
        data-testid="share-item"
        :class="cn(ITEM, bookmark.is_public && 'text-accent')"
        :data-public="bookmark.is_public || undefined"
        type="button"
        role="menuitem"
        @click="select(() => emit('share'))"
      >
        <IconWorld :size="16" />
        Share…
      </button>
      <button
        data-testid="trash-pdf-item"
        v-if="canTrashOriginalPdf"
        :class="cn(ITEM, 'text-danger')"
        type="button"
        role="menuitem"
        @click="onTrashOriginalPdf"
      >
        <IconTrash :size="16" />
        Trash original PDF
      </button>
      <button
        data-testid="archive-item"
        :class="ITEM"
        type="button"
        role="menuitem"
        @click="select(() => emit('archive'))"
      >
        <IconArchive :size="16" />
        Archive
      </button>
      <button
        data-testid="delete-item"
        :class="cn(ITEM, 'text-danger')"
        type="button"
        role="menuitem"
        @click="onDelete"
      >
        <IconTrash :size="16" />
        Delete
      </button>
    </div>
  </div>
</template>
