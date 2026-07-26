<script setup lang="ts">
import BookmarkRow from "./BookmarkRow.vue";
import type { Bookmark } from "../../lib/supabase";

withDefaults(
  defineProps<{
    bookmarks: Bookmark[];
    cachedIds?: Set<string>;
  }>(),
  { cachedIds: () => new Set() },
);

const emit = defineEmits<{
  open: [id: string];
  toggleOffline: [id: string];
}>();
</script>

<template>
  <div class="list">
    <p v-if="bookmarks.length === 0" class="empty-state">Nothing here yet.</p>
    <BookmarkRow
      v-for="bookmark in bookmarks"
      :key="bookmark.id"
      :bookmark="bookmark"
      :is-cached="cachedIds.has(bookmark.id)"
      @open="emit('open', $event)"
      @toggle-offline="emit('toggleOffline', $event)"
    />
  </div>
</template>

<style scoped>
.empty-state {
  padding: 32px 16px;
  text-align: center;
  color: var(--rl-text-muted);
  font-size: 13px;
}
</style>
