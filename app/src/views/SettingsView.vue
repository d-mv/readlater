<script setup lang="ts">
import { shallowRef, useTemplateRef } from "vue";
import { useRouter } from "vue-router";
import { IconArrowLeft, IconDownload, IconUpload } from "@tabler/icons-vue";
import { useDataTransferStore } from "../stores/dataTransfer";
import type { SkippedRow } from "../utils/dataTransfer";
import Button from "../shared/ui/Button.vue";
import IconButton from "../shared/ui/IconButton.vue";
import Message from "../shared/ui/Message.vue";

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
  <main class="mx-auto max-w-560 px-16 pt-24 pb-64">
    <div class="mb-24 flex items-center gap-12">
      <IconButton title="Back" @click="onBack">
        <IconArrowLeft :size="18" />
      </IconButton>
      <h1 class="m-0 text-xl font-bold">Settings</h1>
    </div>

    <section class="mb-16 rounded-md border-[0.5px] border-line bg-raised p-20">
      <h2 class="m-0 mb-8 text-[1.5rem] font-bold">Export</h2>
      <p class="m-0 mb-16 text-sm leading-[1.5] text-ink-muted">
        Download every bookmark and tag as a JSON file. Thumbnail and PDF files stay in this
        project's storage — only their paths/URLs are included, so they won't follow the export into
        a different Supabase project.
      </p>
      <Button test-id="export-btn" :disabled="exporting" @click="onExport">
        <IconDownload :size="16" />
        {{ exporting ? "Exporting…" : "Export bookmarks" }}
      </Button>
      <Message v-if="exportError" tone="danger" test-id="error" class="mt-12">
        {{ exportError }}
      </Message>
    </section>

    <section class="mb-16 rounded-md border-[0.5px] border-line bg-raised p-20">
      <h2 class="m-0 mb-8 text-[1.5rem] font-bold">Import</h2>
      <p class="m-0 mb-16 text-sm leading-[1.5] text-ink-muted">
        Import a Read Later export file. Bookmarks whose URL already exists here are skipped.
      </p>
      <input
        ref="fileInput"
        class="hidden"
        type="file"
        accept="application/json"
        @change="onFileSelected"
      />
      <Button variant="secondary" :disabled="importing" @click="onPickFile">
        <IconUpload :size="16" />
        {{ importing ? "Importing…" : "Choose file to import" }}
      </Button>
      <Message v-if="importError" tone="danger" test-id="error" class="mt-12">
        {{ importError }}
      </Message>
      <p v-if="importedCount !== null" data-testid="result" class="m-0 mt-12 text-sm text-ink">
        Imported {{ importedCount }} bookmark{{ importedCount === 1 ? "" : "s" }}.
        <template v-if="skippedRows.length > 0"> Skipped {{ skippedRows.length }}: </template>
      </p>
      <ul
        v-if="skippedRows.length > 0"
        data-testid="skipped-list"
        class="m-0 mt-8 pl-18 text-sm text-ink-muted"
      >
        <li v-for="(row, index) in skippedRows" :key="index">
          {{ row.title || row.url || "Untitled" }} — {{ row.reason }}
        </li>
      </ul>
    </section>
  </main>
</template>
