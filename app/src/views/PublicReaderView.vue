<script setup lang="ts">
import { onMounted, ref } from "vue";
import { supabase, type PublicBookmark } from "../lib/supabase";
import { readerByline } from "../utils/format";
import ArticleContent from "../components/reader/ArticleContent.vue";

const props = defineProps<{
  id: string;
}>();

const bookmark = ref<PublicBookmark | null>(null);
const loading = ref(true);

onMounted(async () => {
  const { data, error } = await supabase.rpc("get_public_bookmark", { bookmark_id: props.id });
  loading.value = false;

  // get_public_bookmark returns a table of public-safe columns, so supabase-js
  // gives back an array — zero rows means either the id doesn't exist or the
  // bookmark isn't public. Both render the same "not found" state; nothing
  // here distinguishes which case it was.
  const row = Array.isArray(data) ? (data[0] as PublicBookmark | undefined) : undefined;
  if (!error && row) bookmark.value = row;
});
</script>

<template>
  <main class="mx-auto max-w-680 bg-raised p-20">
    <div
      v-if="loading"
      data-testid="status-placeholder"
      class="flex flex-col items-center gap-12 px-16 py-64 text-center text-ink-faint"
    >
      <p class="m-0 font-sans text-base">Loading…</p>
    </div>
    <div
      v-else-if="!bookmark"
      data-testid="status-placeholder"
      class="flex flex-col items-center gap-12 px-16 py-64 text-center text-ink-faint"
    >
      <p class="m-0 font-sans text-base">Not found</p>
    </div>
    <template v-else>
      <h1 data-testid="title" class="m-0 mb-8 font-sans text-xl leading-[1.3] font-medium text-ink">
        {{ bookmark.title }}
      </h1>
      <p v-if="readerByline(bookmark)" class="m-0 mb-20 font-mono text-xs text-ink-faint">
        {{ readerByline(bookmark) }}
      </p>
      <ArticleContent
        :content-md="bookmark.content_md"
        :type="bookmark.type"
        :youtube-video-id="bookmark.youtube_video_id"
        :thumbnail-url="bookmark.thumbnail_url"
      />
    </template>
  </main>
</template>
