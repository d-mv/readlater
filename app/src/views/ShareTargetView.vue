<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useBookmarksStore } from "../stores/bookmarks";
import { isBareUrl, toCaptureOutcome, type CaptureOutcome } from "../utils/captureText";
import Button from "../shared/ui/Button.vue";

const route = useRoute();
const router = useRouter();
const store = useBookmarksStore();

// "saved" never renders here — a successful save routes straight to the list.
const outcome = ref<CaptureOutcome>({ kind: "working" });

function finish() {
  router.replace({ name: "list" });
}

async function onContinueRefresh() {
  if (outcome.value.kind === "duplicate") await store.refresh(outcome.value.id);
  finish();
}

onMounted(async () => {
  const url = typeof route.query.url === "string" ? route.query.url.trim() : "";
  const text = typeof route.query.text === "string" ? route.query.text.trim() : "";
  const targetUrl = url || (text && isBareUrl(text) ? text : "");

  if (targetUrl) {
    const next = toCaptureOutcome(await store.add(targetUrl));
    if (next.kind === "saved") finish();
    else outcome.value = next;
    return;
  }

  if (text) {
    const result = await store.addNote(text);
    if (result.error) outcome.value = { kind: "error", message: result.error };
    else finish();
    return;
  }

  outcome.value = { kind: "error", message: "Nothing to save." };
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
      v-else-if="outcome.kind === 'error'"
      data-testid="status-placeholder"
      class="flex flex-col items-center gap-16 p-32 text-center text-ink-faint"
    >
      <p class="m-0 font-sans text-base">{{ outcome.message }}</p>
      <Button variant="secondary" @click="finish">Back to list</Button>
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
        <Button variant="secondary" @click="finish">Cancel</Button>
        <Button test-id="continue-btn" @click="onContinueRefresh">Continue</Button>
      </div>
    </div>
  </main>
</template>
