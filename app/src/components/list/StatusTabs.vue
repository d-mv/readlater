<script setup lang="ts">
import type { BookmarkFilter } from "../../stores/bookmarks";
import Tabs, { type TabOption } from "../../shared/ui/Tabs.vue";
import Pill from "../../shared/ui/Pill.vue";

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
    class="border-b-[0.5px] border-line px-16 py-12"
    @update:model-value="emit('change', $event)"
  >
    <Pill v-if="unreadCount > 0" tone="wash" class="ml-auto px-10 py-4 text-2xs"
      >{{ unreadCount }} unread</Pill
    >
  </Tabs>
</template>
