<script setup lang="ts">
import { shallowRef, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import { IconArrowLeft, IconDownload, IconUpload } from "@tabler/icons-vue";
import { useDataTransferStore } from "../stores/dataTransfer";
import type { SkippedRow } from "../utils/dataTransfer";

const router = useRouter();
const store = useDataTransferStore();

const exporting = shallowRef(false);
const exportError = shallowRef<string | null>(null);

const importing = shallowRef(false);
const importError = shallowRef<string | null>(null);
const importedCount = shallowRef<number | null>(null);
const skippedRows = shallowRef<SkippedRow[]>([]);

const fileInput = useTemplateRef<HTMLInputElement>("fileInput");

function onBack() {
  router.push({ name: "list" });
}

async function onExport() {
  exporting.value = true;
  exportError.value = null;

  const { payload, error } = await store.exportBookmarks();
  exporting.value = false;

  if (error || !payload) {
    exportError.value = error ?? "Export failed.";
    return;
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `readlater-export-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function onPickFile() {
  fileInput.value?.click();
}

async function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  importing.value = true;
  importError.value = null;
  importedCount.value = null;
  skippedRows.value = [];

  const text = await file.text();
  const result = await store.importBookmarks(text);

  importing.value = false;
  input.value = "";

  if (result.error) {
    importError.value = result.error;
    return;
  }
  importedCount.value = result.imported;
  skippedRows.value = result.skipped;
}
</script>

<template>
  <main class="settings-view">
    <div class="header-row">
      <button class="icon-btn" type="button" aria-label="Back" @click="onBack">
        <IconArrowLeft :size="18" />
      </button>
      <h1>Settings</h1>
    </div>

    <section class="panel">
      <h2>Export</h2>
      <p class="hint">
        Download every bookmark and tag as a JSON file. Thumbnail and PDF files stay in this
        project's storage — only their paths/URLs are included, so they won't follow the export into
        a different Supabase project.
      </p>
      <button class="btn btn-primary" type="button" :disabled="exporting" @click="onExport">
        <IconDownload :size="16" />
        {{ exporting ? "Exporting…" : "Export bookmarks" }}
      </button>
      <p v-if="exportError" class="error">{{ exportError }}</p>
    </section>

    <section class="panel">
      <h2>Import</h2>
      <p class="hint">
        Import a Read Later export file. Bookmarks whose URL already exists here are skipped.
      </p>
      <input
        ref="fileInput"
        class="file-input"
        type="file"
        accept="application/json"
        @change="onFileSelected"
      />
      <button class="btn btn-secondary" type="button" :disabled="importing" @click="onPickFile">
        <IconUpload :size="16" />
        {{ importing ? "Importing…" : "Choose file to import" }}
      </button>
      <p v-if="importError" class="error">{{ importError }}</p>
      <p v-if="importedCount !== null" class="result">
        Imported {{ importedCount }} bookmark{{ importedCount === 1 ? "" : "s" }}.
        <template v-if="skippedRows.length > 0"> Skipped {{ skippedRows.length }}: </template>
      </p>
      <ul v-if="skippedRows.length > 0" class="skipped-list">
        <li v-for="(row, index) in skippedRows" :key="index">
          {{ row.title || row.url || "Untitled" }} — {{ row.reason }}
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.settings-view {
  max-width: 560px;
  margin: 0 auto;
  padding: 24px 16px 64px;
}

.header-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.header-row h1 {
  font-size: 20px;
  margin: 0;
}

.icon-btn {
  display: inline-flex;
  border: none;
  background: transparent;
  color: var(--rl-text-secondary);
  cursor: pointer;
  padding: 0;
}

.panel {
  background: var(--rl-surface);
  border: 0.5px solid var(--rl-border);
  border-radius: var(--rl-radius);
  padding: 20px;
  margin-bottom: 16px;
}

.panel h2 {
  font-size: 15px;
  margin: 0 0 8px;
}

.hint {
  font-size: 13px;
  color: var(--rl-text-secondary);
  margin: 0 0 16px;
  line-height: 1.5;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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

.btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.file-input {
  display: none;
}

.error {
  color: var(--rl-danger);
  font-size: 13px;
  margin: 12px 0 0;
}

.result {
  font-size: 13px;
  color: var(--rl-text-primary);
  margin: 12px 0 0;
}

.skipped-list {
  margin: 8px 0 0;
  padding-left: 18px;
  font-size: 13px;
  color: var(--rl-text-secondary);
}
</style>
