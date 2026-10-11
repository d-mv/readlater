<script setup lang="ts">
import BookmarkRow from "./BookmarkRow.vue";
import type { Bookmark } from "../../lib/supabase";
import Empty from "../../shared/ui/Empty.vue";

withDefaults(
  defineProps<{
    bookmarks: Bookmark[];
    cachedIds?: Set<string>;
    missingImageCounts?: ReadonlyMap<string, number>;
  }>(),
  { cachedIds: () => new Set(), missingImageCounts: () => new Map() },
);

const emit = defineEmits<{
  open: [id: string];
  toggleOffline: [id: string];
}>();
</script>

<template>
  <div>
    <Empty v-if="bookmarks.length === 0" test-id="empty-state" class="my-13">
      Nothing here yet.
    </Empty>
    <BookmarkRow
      v-for="bookmark in bookmarks"
      :key="bookmark.id"
      :bookmark="bookmark"
      :is-cached="cachedIds.has(bookmark.id)"
      :missing-images="missingImageCounts.get(bookmark.id) ?? 0"
      @open="emit('open', $event)"
      @toggle-offline="emit('toggleOffline', $event)"
    />
  </div>
</template>
