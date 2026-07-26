<script setup lang="ts">
import type { Tag } from "../../lib/supabase";

const props = defineProps<{
  tags: Tag[];
  activeTagIds: string[];
}>();

const emit = defineEmits<{
  toggle: [tagId: string];
}>();

function isActive(tagId: string): boolean {
  return props.activeTagIds.includes(tagId);
}
</script>

<template>
  <div v-if="tags.length > 0" class="tag-filter-bar">
    <button
      v-for="tag in tags"
      :key="tag.id"
      class="tag-chip"
      :class="{ 'tag-chip-active': isActive(tag.id) }"
      type="button"
      :style="{ '--tag-color': tag.color }"
      @click="emit('toggle', tag.id)"
    >
      {{ tag.name }}
    </button>
  </div>
</template>

<style scoped>
.tag-filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 16px 4px;
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 12px;
  border-radius: 999px;
  border: 0.5px solid var(--rl-border);
  background: transparent;
  color: var(--rl-text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.tag-chip-active {
  border-color: var(--tag-color, var(--rl-accent));
  background: var(--tag-color, var(--rl-accent));
  color: var(--rl-on-accent);
}
</style>
