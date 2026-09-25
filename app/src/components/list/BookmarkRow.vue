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
import IconButton from "../../shared/ui/IconButton.vue";
import { cn } from "../../shared/clsx";

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
// Driven by translated_lang rather than translated_content_md: the list query
// omits the translation body, and the two columns are always written together.
const isTranslated = computed(() => props.bookmark.translated_lang !== null);
const displayTitle = computed(() => {
  if (props.bookmark.title) return props.bookmark.title;
  if (isFailed.value) return "Failed to process";
  if (isPending.value) return "Processing…";
  return props.bookmark.url ?? (props.bookmark.type === "pdf" ? "PDF" : "Note");
});
</script>

<template>
  <div data-testid="row" class="flex w-full items-center gap-4 border-t-[0.5px] border-line px-16">
    <button
      class="flex min-w-0 flex-1 cursor-pointer items-center gap-12 border-0 bg-transparent px-0 py-14 text-left [font:inherit]"
      type="button"
      @click="emit('open', bookmark.id)"
    >
      <span class="flex size-32 shrink-0 items-center justify-center rounded-sm bg-raised">
        <IconLoader2 v-if="isPending" :size="16" class="animate-spin text-ink-muted" />
        <IconAlertTriangle v-else-if="isFailed" :size="16" class="text-danger" />
        <component :is="iconComponent" v-else :size="16" class="text-ink-muted" />
      </span>
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="flex min-w-0 items-center gap-4">
          <span
            data-testid="title"
            :class="
              cn(
                'truncate text-base font-medium text-ink',
                isRead && 'font-normal text-ink-faint',
                isPending && 'italic text-ink-faint',
                isFailed && 'text-danger',
              )
            "
            :data-read="isRead || undefined"
            >{{ displayTitle }}</span
          >
          <IconWorld
            v-if="bookmark.is_public"
            data-testid="public-badge"
            :size="12"
            class="shrink-0 text-accent"
            aria-label="Shared publicly"
          />
        </span>
        <span class="mt-4 flex min-w-0 items-center gap-4">
          <span class="truncate text-xs text-ink-faint">{{ meta }}</span>
          <IconLanguageHiragana
            v-if="isTranslated"
            data-testid="translated-badge"
            :size="12"
            class="shrink-0 text-ink-faint"
            aria-label="Translated"
          />
        </span>
      </span>
    </button>
    <IconButton
      v-if="isUnread"
      test-id="offline-toggle"
      :title="isCached ? 'Remove offline copy' : 'Save offline'"
      :pressed="isCached"
      :class="cn('size-28 shrink-0 rounded-sm text-ink-faint', isCached && 'text-accent')"
      @click="emit('toggleOffline', bookmark.id)"
    >
      <IconCheck v-if="isCached" :size="16" />
      <IconDownload v-else :size="16" />
    </IconButton>
  </div>
</template>
