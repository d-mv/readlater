<script setup lang="ts">
import { computed } from "vue";
import type { Bookmark } from "../../lib/supabase";

const props = defineProps<{
  bookmark: Bookmark;
}>();

const emit = defineEmits<{
  markRead: [];
}>();

const canMarkRead = computed(() => props.bookmark.status === "ready" && props.bookmark.read_at === null);
</script>

<template>
  <div class="actions">
    <a
      v-if="bookmark.url"
      class="btn btn-secondary open-original"
      :href="bookmark.url"
      target="_blank"
      rel="noopener"
    >
      Open original
    </a>
    <button v-if="canMarkRead" class="btn btn-primary mark-read" type="button" @click="emit('markRead')">
      Mark as read
    </button>
  </div>
</template>

<style scoped>
.actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding: 16px;
  border-top: 0.5px solid var(--rl-border);
}

.btn {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 14px;
  border-radius: var(--rl-radius);
  font-size: 13px;
  text-decoration: none;
  cursor: pointer;
  border: none;
}

.btn-secondary {
  background: transparent;
  border: 0.5px solid var(--rl-border);
  color: var(--rl-text-primary);
}

.btn-primary {
  background: var(--rl-accent);
  color: var(--rl-on-accent);
  font-weight: 500;
}
</style>
