<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useBookmarksStore } from "../stores/bookmarks";
import { toCaptureOutcome, type CaptureOutcome } from "../utils/captureText";
import Button from "../shared/ui/Button.vue";

const route = useRoute();
const store = useBookmarksStore();

const outcome = ref<CaptureOutcome>({ kind: "working" });

// Opened as a popup by the bookmarklet, so closing the tab is the natural
// "done" action — but window.close() silently no-ops on a tab the browser
// doesn't consider script-opened (e.g. if this got opened as a normal tab
// instead), so the "Saved" state always leaves a manual Close button too.
function close() {
  window.close();
}

function finish() {
  outcome.value = { kind: "saved" };
  setTimeout(close, 800);
}

async function onContinueRefresh() {
  if (outcome.value.kind === "duplicate") await store.refresh(outcome.value.id);
  finish();
}

onMounted(async () => {
  const url = typeof route.query.url === "string" ? route.query.url.trim() : "";
  const title = typeof route.query.title === "string" ? route.query.title.trim() : undefined;

  if (!url) {
    outcome.value = { kind: "error", message: "Nothing to save." };
    return;
  }

  const next = toCaptureOutcome(await store.add(url, { title }));
  if (next.kind === "saved") finish();
  else outcome.value = next;
});
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-480 items-center justify-center bg-canvas">
    <div
      v-if="outcome.kind === 'working'"
      data-testid="status-placeholder"
      class="flex flex-col items-center gap-16 p-32 text-center text-ink-faint"
    >
      <p class="m-0 font-sans text-base">Saving…</p>
    </div>
    <div
      v-else-if="outcome.kind === 'saved'"
      data-testid="status-placeholder"
      class="flex flex-col items-center gap-16 p-32 text-center text-ink-faint"
    >
      <p class="m-0 font-sans text-base">Saved</p>
      <Button variant="secondary" @click="close">Close</Button>
    </div>
    <div
      v-else-if="outcome.kind === 'error'"
      data-testid="status-placeholder"
      class="flex flex-col items-center gap-16 p-32 text-center text-ink-faint"
    >
      <p class="m-0 font-sans text-base">{{ outcome.message }}</p>
      <Button variant="secondary" @click="close">Close</Button>
    </div>
    <div
      v-else-if="outcome.kind === 'duplicate'"
      data-testid="status-placeholder"
      class="flex flex-col items-center gap-16 p-32 text-center text-ink-faint"
    >
      <p class="m-0 font-sans text-base">
        Already saved on {{ new Date(outcome.savedAt).toLocaleDateString() }}
      </p>
      <div class="flex gap-12">
        <Button variant="secondary" @click="close">Cancel</Button>
        <Button test-id="continue-btn" @click="onContinueRefresh">Continue</Button>
      </div>
    </div>
  </main>
</template>
