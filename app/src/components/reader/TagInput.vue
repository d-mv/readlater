<script setup lang="ts">
import { ref } from "vue";
import { IconX } from "@tabler/icons-vue";
import type { Tag } from "../../lib/supabase";

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
  <div class="tag-input">
    <span v-for="tag in tags" :key="tag.id" class="tag-chip" :style="{ '--tag-color': tag.color }">
      {{ tag.name }}
      <button class="remove-btn" type="button" :aria-label="`Remove ${tag.name}`" @click="emit('remove', tag.id)">
        <IconX :size="12" />
      </button>
    </span>
    <input
      v-model="draft"
      class="tag-draft-input"
      type="text"
      placeholder="Add tag…"
      @keydown.enter.prevent="onSubmit"
    />
  </div>
</template>

<style scoped>
.tag-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--tag-color, var(--rl-border));
  color: var(--rl-on-accent);
  font-size: 12px;
}

.remove-btn {
  display: inline-flex;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0;
  opacity: 0.8;
}

.tag-draft-input {
  border: none;
  background: transparent;
  font-size: 12px;
  color: var(--rl-text-primary);
  min-width: 80px;
  flex: 1;
}

.tag-draft-input:focus {
  outline: none;
}
</style>
