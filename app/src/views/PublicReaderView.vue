<script setup lang="ts">
import { onMounted, ref } from "vue";
import { supabase, type Bookmark } from "../lib/supabase";
import { readerByline } from "../utils/format";
import ArticleContent from "../components/reader/ArticleContent.vue";

const props = defineProps<{
  id: string;
}>();

const bookmark = ref<Bookmark | null>(null);
const loading = ref(true);

onMounted(async () => {
  const { data, error } = await supabase.rpc("get_public_bookmark", { bookmark_id: props.id });
  loading.value = false;

  // get_public_bookmark is `returns setof bookmarks`, so supabase-js gives
  // back an array — zero rows means either the id doesn't exist or the
  // bookmark isn't public. Both render the same "not found" state; nothing
  // here distinguishes which case it was.
  const row = Array.isArray(data) ? data[0] : undefined;
  if (!error && row) bookmark.value = row;
});
</script>

<template>
  <main class="public-reader">
    <div v-if="loading" class="status-placeholder">
      <p class="status-text">Loading…</p>
    </div>
    <div v-else-if="!bookmark" class="status-placeholder">
      <p class="status-text">Not found</p>
    </div>
    <template v-else>
      <h1 class="title">{{ bookmark.title }}</h1>
      <p v-if="readerByline(bookmark)" class="byline">{{ readerByline(bookmark) }}</p>
      <ArticleContent :content-md="bookmark.content_md" />
    </template>
  </main>
</template>

<style scoped>
.public-reader {
  max-width: 680px;
  margin: 0 auto;
  padding: 20px;
  background: var(--rl-surface);
}

.title {
  font-family: var(--rl-font-ui);
  font-size: 20px;
  font-weight: 500;
  color: var(--rl-text-primary);
  line-height: 1.3;
  margin: 0 0 8px;
}

.byline {
  font-family: var(--rl-font-mono);
  font-size: 12px;
  color: var(--rl-text-muted);
  margin: 0 0 20px;
}

.status-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 64px 16px;
  text-align: center;
  color: var(--rl-text-muted);
}

.status-text {
  font-family: var(--rl-font-ui);
  font-size: 14px;
  margin: 0;
}
</style>
