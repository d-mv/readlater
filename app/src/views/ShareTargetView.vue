<script setup lang="ts">
import { nextTick, onMounted, ref, shallowRef, useTemplateRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useBookmarksStore } from "../stores/bookmarks";
import { isBareUrl, toCaptureOutcome, type CaptureOutcome } from "../utils/captureText";
import Button from "../shared/ui/Button.vue";

const route = useRoute();
const router = useRouter();
const store = useBookmarksStore();

// "saved" never renders here — a successful save routes straight to the list.
const outcome = ref<CaptureOutcome>({ kind: "working" });
// What Save will store: a URL (from the url param, or text that is itself a
// bare URL), else the shared text as a note.
const shared = shallowRef<{ kind: "url"; url: string } | { kind: "note"; text: string } | null>(
  null,
);
const confirmPanel = useTemplateRef<HTMLElement>("confirmPanel");

function finish() {
  router.replace({ name: "list" });
}

// The manifest declares the share target as GET, so /share-target?url=… is
// an ordinary URL any website can navigate to — the OS share sheet and a
// cross-site link look the same here. Saving therefore waits for the user's
// click, exactly like /capture.
async function save() {
  const item = shared.value;
  if (outcome.value.kind !== "confirm" || !item) return;
  outcome.value = { kind: "working" };

  if (item.kind === "url") {
    const next = toCaptureOutcome(await store.add(item.url));
    if (next.kind === "saved") finish();
    else outcome.value = next;
    return;
  }

  const result = await store.addNote(item.text);
  if (result.error) outcome.value = { kind: "error", message: result.error };
  else finish();
}

async function onContinueRefresh() {
  if (outcome.value.kind !== "duplicate") return;
  const { error } = await store.refresh(outcome.value.id);
  if (error) outcome.value = { kind: "error", message: error };
  else finish();
}

onMounted(async () => {
  const url = typeof route.query.url === "string" ? route.query.url.trim() : "";
  const text = typeof route.query.text === "string" ? route.query.text.trim() : "";
  const targetUrl = url || (text && isBareUrl(text) ? text : "");

  if (targetUrl) shared.value = { kind: "url", url: targetUrl };
  else if (text) shared.value = { kind: "note", text };
  else {
    outcome.value = { kind: "error", message: "Nothing to save." };
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
      v-if="outcome.kind === 'confirm' && shared"
      ref="confirmPanel"
      data-testid="confirm-panel"
      class="flex min-w-0 flex-col items-center gap-16 p-32 text-center"
    >
      <p v-if="shared.kind === 'url'" class="m-0 text-sm break-all text-ink">{{ shared.url }}</p>
      <p v-else class="m-0 line-clamp-6 text-sm break-words whitespace-pre-line text-ink">
        {{ shared.text }}
      </p>
      <div class="flex gap-12">
        <Button variant="secondary" @click="finish">Cancel</Button>
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
