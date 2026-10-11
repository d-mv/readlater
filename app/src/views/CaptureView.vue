<script setup lang="ts">
import { nextTick, onMounted, ref, shallowRef, useTemplateRef } from "vue";
import { useRoute } from "vue-router";
import { useBookmarksStore } from "../stores/bookmarks";
import { isHttpUrl } from "../utils/bookmarkType";
import { toCaptureOutcome, type CaptureOutcome } from "../utils/captureText";
import Button from "../shared/ui/Button.vue";

const route = useRoute();
const store = useBookmarksStore();

const outcome = ref<CaptureOutcome>({ kind: "working" });
const url = shallowRef("");
const title = shallowRef<string | undefined>(undefined);
const confirmPanel = useTemplateRef<HTMLElement>("confirmPanel");

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

// Never runs on load: any website can open /capture?url=…, so only the
// user's click (or Enter on the focused Save button) saves.
async function save() {
  if (outcome.value.kind !== "confirm") return;
  outcome.value = { kind: "working" };
  const next = toCaptureOutcome(await store.add(url.value, { title: title.value }));
  if (next.kind === "saved") finish();
  else outcome.value = next;
}

async function onContinueRefresh() {
  if (outcome.value.kind !== "duplicate") return;
  const { error } = await store.refresh(outcome.value.id);
  if (error) outcome.value = { kind: "error", message: error };
  else finish();
}

onMounted(async () => {
  url.value = typeof route.query.url === "string" ? route.query.url.trim() : "";
  title.value =
    typeof route.query.title === "string" ? route.query.title.trim() || undefined : undefined;

  if (!url.value) {
    outcome.value = { kind: "error", message: "Nothing to save." };
    return;
  }
  if (!isHttpUrl(url.value)) {
    outcome.value = { kind: "error", message: "Only http(s) pages can be saved." };
    return;
  }

  outcome.value = { kind: "confirm" };
  // The Button component doesn't forward an autofocus attribute; focusing it
  // here gives the same result — Enter (or Space) saves straight away.
  await nextTick();
  confirmPanel.value?.querySelector<HTMLButtonElement>('[data-testid="save-btn"]')?.focus();
});
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-480 items-center justify-center bg-canvas">
    <div
      v-if="outcome.kind === 'confirm'"
      ref="confirmPanel"
      data-testid="confirm-panel"
      class="flex min-w-0 flex-col items-center gap-16 p-32 text-center"
    >
      <p class="m-0 font-sans text-base break-words text-ink">{{ title ?? url }}</p>
      <p v-if="title" class="m-0 text-sm break-all text-ink-muted">{{ url }}</p>
      <div class="flex gap-12">
        <Button variant="secondary" @click="close">Cancel</Button>
        <Button test-id="save-btn" @click="save">Save</Button>
      </div>
    </div>
    <div
      v-else-if="outcome.kind === 'working'"
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
