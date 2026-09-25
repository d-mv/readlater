<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useBookmarksStore } from "../stores/bookmarks";
import { toCaptureOutcome, type CaptureOutcome } from "../utils/captureText";

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
  <main class="capture">
    <div
      data-testid="status-placeholder"
      v-if="outcome.kind === 'working'"
      class="status-placeholder"
    >
      <p class="status-text">Saving…</p>
    </div>
    <div
      data-testid="status-placeholder"
      v-else-if="outcome.kind === 'saved'"
      class="status-placeholder"
    >
      <p class="status-text">Saved</p>
      <button class="btn btn-secondary" type="button" @click="close">Close</button>
    </div>
    <div
      data-testid="status-placeholder"
      v-else-if="outcome.kind === 'error'"
      class="status-placeholder"
    >
      <p class="status-text">{{ outcome.message }}</p>
      <button class="btn btn-secondary" type="button" @click="close">Close</button>
    </div>
    <div
      data-testid="status-placeholder"
      v-else-if="outcome.kind === 'duplicate'"
      class="status-placeholder"
    >
      <p class="status-text">
        Already saved on {{ new Date(outcome.savedAt).toLocaleDateString() }}
      </p>
      <div class="duplicate-actions">
        <button class="btn btn-secondary" type="button" @click="close">Cancel</button>
        <button
          data-testid="continue-btn"
          class="btn btn-primary"
          type="button"
          @click="onContinueRefresh"
        >
          Continue
        </button>
      </div>
    </div>
  </main>
</template>

<style scoped>
.capture {
  max-width: 480px;
  margin: 0 auto;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--rl-bg);
}

.status-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 32px;
  text-align: center;
  color: var(--rl-text-muted);
}

.status-text {
  font-family: var(--rl-font-ui);
  font-size: 14px;
  margin: 0;
}

.duplicate-actions {
  display: flex;
  gap: 12px;
}

.btn {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 14px;
  border-radius: var(--rl-radius);
  font-size: 13px;
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
