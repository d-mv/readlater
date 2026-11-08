<script setup lang="ts">
import { IconSortAscending, IconSortDescending } from "@tabler/icons-vue";
import type { ListSort } from "../../stores/bookmarks";
import IconButton from "../../shared/ui/IconButton.vue";
import { cn } from "../../shared/clsx";

export interface SortToggleProps {
  sort: ListSort;
}

export interface SortToggleEmits {
  (e: "change", sort: ListSort): void;
}

const props = defineProps<SortToggleProps>();
const emit = defineEmits<SortToggleEmits>();
</script>

<template>
  <!-- Two orders, so one toggle: pressed = oldest first. The icon shows the
       order in use. -->
  <IconButton
    test-id="sort-toggle"
    title="Oldest first"
    :pressed="props.sort === 'oldest'"
    :class="cn('-mt-8 size-28 shrink-0 hover:text-ink', props.sort === 'oldest' && 'text-ink')"
    @click="emit('change', props.sort === 'oldest' ? 'newest' : 'oldest')"
  >
    <IconSortAscending v-if="props.sort === 'oldest'" :size="16" />
    <IconSortDescending v-else :size="16" />
  </IconButton>
</template>
