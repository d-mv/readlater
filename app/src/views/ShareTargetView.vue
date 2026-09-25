<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useBookmarksStore } from "../stores/bookmarks";
import { isBareUrl, toCaptureOutcome, type CaptureOutcome } from "../utils/captureText";

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
  <main class="share-target">
    <div
      data-testid="status-placeholder"
      v-if="outcome.kind === 'working'"
      class="status-placeholder"
    >
      <p class="status-text">Saving…</p>
    </div>
    <div
      data-testid="status-placeholder"
      v-else-if="outcome.kind === 'error'"
      class="status-placeholder"
    >
      <p class="status-text">{{ outcome.message }}</p>
      <button class="btn btn-secondary" type="button" @click="finish">Back to list</button>
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
        <button class="btn btn-secondary" type="button" @click="finish">Cancel</button>
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
.share-target {
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
