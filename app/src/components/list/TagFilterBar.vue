<script setup lang="ts">
import type { Tag } from "../../lib/supabase";
import Pill from "../../shared/ui/Pill.vue";

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
  <div
    v-if="tags.length > 0"
    data-testid="tag-filter-bar"
    class="flex flex-wrap gap-8 px-16 pt-8 pb-4"
  >
    <Pill
      v-for="tag in tags"
      :key="tag.id"
      as="button"
      test-id="tag-chip"
      :tone="isActive(tag.id) ? 'solid' : 'outline'"
      :pressed="isActive(tag.id)"
      :color="tag.color"
      class="h-26 px-12"
      @click="emit('toggle', tag.id)"
    >
      {{ tag.name }}
    </Pill>
  </div>
</template>
