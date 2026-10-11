<script setup lang="ts">
import type { BookmarkFilter } from "../../stores/bookmarks";
import Tabs, { type TabOption } from "../../shared/ui/Tabs.vue";

defineProps<{
  activeFilter: BookmarkFilter;
  unreadCount: number;
}>();

const emit = defineEmits<{
  change: [filter: BookmarkFilter];
}>();

const options: TabOption<BookmarkFilter>[] = [
  { value: "all", label: "All", testId: "tab" },
  { value: "archived", label: "Archived", testId: "tab" },
];
</script>

<template>
  <Tabs
    :options="options"
    :model-value="activeFilter"
    class="border-b border-line px-16 py-12"
    @update:model-value="emit('change', $event)"
  >
    <span
      v-if="unreadCount > 0"
      class="num ml-auto pb-8 text-sm text-ink-muted sm:text-2xs uppercase"
      >{{ unreadCount }} unread</span
    >
  </Tabs>
</template>
