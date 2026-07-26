<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useBookmarksStore } from "../stores/bookmarks";

const route = useRoute();
const store = useBookmarksStore();

type Status = "working" | "saved" | "duplicate" | "error";
const status = ref<Status>("working");
const errorMessage = ref("");
const duplicateId = ref<string | null>(null);
const duplicateSavedAt = ref<string | null>(null);

// Opened as a popup by the bookmarklet, so closing the tab is the natural
// "done" action — but window.close() silently no-ops on a tab the browser
// doesn't consider script-opened (e.g. if this got opened as a normal tab
// instead), so the "Saved" state always leaves a manual Close button too.
function close() {
  window.close();
}

function finish() {
  status.value = "saved";
  setTimeout(close, 800);
}

async function onContinueRefresh() {
  if (duplicateId.value) await store.refresh(duplicateId.value);
  finish();
}

onMounted(async () => {
  const url = typeof route.query.url === "string" ? route.query.url.trim() : "";
  const title = typeof route.query.title === "string" ? route.query.title.trim() : undefined;

  if (!url) {
    status.value = "error";
    errorMessage.value = "Nothing to save.";
    return;
  }

  const result = await store.add(url, { title });
  if (result.error) {
    status.value = "error";
    errorMessage.value = result.error;
  } else if (result.duplicate && result.existingId && result.existingSavedAt) {
    status.value = "duplicate";
    duplicateId.value = result.existingId;
    duplicateSavedAt.value = result.existingSavedAt;
  } else {
    finish();
  }
});
</script>

<template>
  <main class="capture">
    <div v-if="status === 'working'" class="status-placeholder">
      <p class="status-text">Saving…</p>
    </div>
    <div v-else-if="status === 'saved'" class="status-placeholder">
      <p class="status-text">Saved</p>
      <button class="btn btn-secondary" type="button" @click="close">Close</button>
    </div>
    <div v-else-if="status === 'error'" class="status-placeholder">
      <p class="status-text">{{ errorMessage }}</p>
      <button class="btn btn-secondary" type="button" @click="close">Close</button>
    </div>
    <div v-else-if="status === 'duplicate'" class="status-placeholder">
      <p class="status-text">Already saved on {{ new Date(duplicateSavedAt!).toLocaleDateString() }}</p>
      <div class="duplicate-actions">
        <button class="btn btn-secondary" type="button" @click="close">Cancel</button>
        <button class="btn btn-primary" type="button" @click="onContinueRefresh">Continue</button>
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
