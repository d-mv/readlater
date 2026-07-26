<script setup lang="ts">
import type { BookmarkFilter } from "../../stores/bookmarks";

defineProps<{
  activeFilter: BookmarkFilter;
  unreadCount: number;
}>();

const emit = defineEmits<{
  change: [filter: BookmarkFilter];
}>();
</script>

<template>
  <div class="tabs">
    <button
      class="tab"
      type="button"
      :class="{ 'tab-active': activeFilter === 'all' }"
      @click="emit('change', 'all')"
    >
      All
    </button>
    <button
      class="tab"
      type="button"
      :class="{ 'tab-active': activeFilter === 'archived' }"
      @click="emit('change', 'archived')"
    >
      Archived
    </button>
    <span v-if="unreadCount > 0" class="badge">{{ unreadCount }} unread</span>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 12px 16px;
  border-bottom: 0.5px solid var(--rl-border);
}

.tab {
  border: none;
  background: transparent;
  padding: 0 0 8px;
  font-size: 13px;
  color: var(--rl-text-secondary);
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font: inherit;
}

.tab-active {
  font-weight: 500;
  color: var(--rl-text-primary);
  border-bottom-color: var(--rl-accent);
}

.badge {
  margin-left: auto;
  background: var(--rl-accent-tint);
  color: var(--rl-on-accent-tint);
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
}
</style>
