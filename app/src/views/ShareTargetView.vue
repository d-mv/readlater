<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useBookmarksStore } from "../stores/bookmarks";
import { isBareUrl } from "../utils/captureText";

const route = useRoute();
const router = useRouter();
const store = useBookmarksStore();

type Status = "working" | "duplicate" | "error";
const status = ref<Status>("working");
const errorMessage = ref("");
const duplicateId = ref<string | null>(null);
const duplicateSavedAt = ref<string | null>(null);

function finish() {
  router.replace({ name: "list" });
}

async function onContinueRefresh() {
  if (duplicateId.value) await store.refresh(duplicateId.value);
  finish();
}

onMounted(async () => {
  const url = typeof route.query.url === "string" ? route.query.url.trim() : "";
  const text = typeof route.query.text === "string" ? route.query.text.trim() : "";
  const targetUrl = url || (text && isBareUrl(text) ? text : "");

  if (targetUrl) {
    const result = await store.add(targetUrl);
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
    return;
  }

  if (text) {
    const result = await store.addNote(text);
    if (result.error) {
      status.value = "error";
      errorMessage.value = result.error;
    } else {
      finish();
    }
    return;
  }

  status.value = "error";
  errorMessage.value = "Nothing to save.";
});
</script>

<template>
  <main class="share-target">
    <div v-if="status === 'working'" class="status-placeholder">
      <p class="status-text">Saving…</p>
    </div>
    <div v-else-if="status === 'error'" class="status-placeholder">
      <p class="status-text">{{ errorMessage }}</p>
      <button class="btn btn-secondary" type="button" @click="finish">Back to list</button>
    </div>
    <div v-else-if="status === 'duplicate'" class="status-placeholder">
      <p class="status-text">Already saved on {{ new Date(duplicateSavedAt!).toLocaleDateString() }}</p>
      <div class="duplicate-actions">
        <button class="btn btn-secondary" type="button" @click="finish">Cancel</button>
        <button class="btn btn-primary" type="button" @click="onContinueRefresh">Continue</button>
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
