<script setup lang="ts">
import { computed } from "vue";
import { IconArchive, IconChevronLeft, IconExternalLink, IconTrash } from "@tabler/icons-vue";
import type { Bookmark } from "../../lib/supabase";
import { domainFromUrl } from "../../utils/format";
import FontSizeControl from "./FontSizeControl.vue";

const props = defineProps<{
  bookmark: Bookmark;
}>();

const emit = defineEmits<{
  back: [];
  archive: [];
  delete: [];
}>();

const domain = computed(() => domainFromUrl(props.bookmark.url));

function onDelete() {
  if (window.confirm("Delete this article? This can't be undone.")) {
    emit("delete");
  }
}
</script>

<template>
  <div class="header">
    <button class="icon-btn back-btn" type="button" @click="emit('back')">
      <IconChevronLeft :size="20" />
    </button>
    <span class="domain">{{ domain }}</span>
    <div class="actions">
      <FontSizeControl />
      <button class="icon-btn archive-btn" type="button" @click="emit('archive')">
        <IconArchive :size="18" />
      </button>
      <button class="icon-btn delete-btn" type="button" @click="onDelete">
        <IconTrash :size="18" />
      </button>
      <a class="icon-btn external-link-btn" :href="bookmark.url" target="_blank" rel="noopener">
        <IconExternalLink :size="18" />
      </a>
    </div>
  </div>
</template>

<style scoped>
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 0.5px solid var(--rl-border);
}

.domain {
  font-family: var(--rl-font-mono);
  font-size: 12px;
  color: var(--rl-text-muted);
}

.actions {
  display: flex;
  gap: 16px;
}

.icon-btn {
  display: inline-flex;
  border: none;
  background: transparent;
  color: var(--rl-text-secondary);
  cursor: pointer;
  padding: 0;
}
</style>
