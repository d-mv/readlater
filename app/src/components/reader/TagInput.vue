<script setup lang="ts">
import { ref } from "vue";
import { IconX } from "@tabler/icons-vue";
import type { Tag } from "../../lib/supabase";
import IconButton from "../../shared/ui/IconButton.vue";
import Pill from "../../shared/ui/Pill.vue";

defineProps<{
  tags: Tag[];
}>();

const emit = defineEmits<{
  add: [name: string];
  remove: [tagId: string];
}>();

const draft = ref("");

function onSubmit() {
  const name = draft.value.trim();
  if (!name) return;
  emit("add", name);
  draft.value = "";
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-8 px-16 py-12">
    <Pill
      v-for="tag in tags"
      :key="tag.id"
      tone="solid"
      test-id="tag-chip"
      :color="tag.color"
      class="h-24 gap-4 border-0 bg-(--tag-color,var(--color-line)) px-8"
    >
      {{ tag.name }}
      <IconButton
        :title="`Remove ${tag.name}`"
        test-id="remove-btn"
        class="text-[inherit] opacity-80"
        @click="emit('remove', tag.id)"
      >
        <IconX :size="12" />
      </IconButton>
    </Pill>
    <input
      v-model="draft"
      data-testid="tag-draft-input"
      class="min-w-80 flex-1 border-0 bg-transparent px-2 py-1 text-xs leading-[normal] text-ink focus:outline-none"
      type="text"
      placeholder="Add tag…"
      @keydown.enter.prevent="onSubmit"
    />
  </div>
</template>
