<script setup lang="ts">
import { shallowRef } from "vue";
import { useBookmarksStore } from "../../stores/bookmarks";
import { detectFileKind, maxBytesForFileKind } from "../../utils/fileKind";

type Mode = "url" | "snippet" | "file";

const FILE_KIND_LIMIT_LABEL = { markdown: "500KB", docx: "5MB", pdf: "20MB" } as const;

const store = useBookmarksStore();

const isOpen = shallowRef(false);
const mode = shallowRef<Mode>("url");
const url = shallowRef("");
const snippetText = shallowRef("");
const snippetHtml = shallowRef<string | null>(null);
const selectedFile = shallowRef<File | null>(null);
const error = shallowRef<string | null>(null);
const submitting = shallowRef(false);
const duplicate = shallowRef(false);
const fileInput = shallowRef<HTMLInputElement | null>(null);
const isDragging = shallowRef(false);
const dragDepth = shallowRef(0);

function open() {
  mode.value = "url";
  url.value = "";
  snippetText.value = "";
  snippetHtml.value = null;
  selectedFile.value = null;
  error.value = null;
  duplicate.value = false;
  isOpen.value = true;
}

function cancel() {
  isOpen.value = false;
}

function setMode(next: Mode) {
  mode.value = next;
  error.value = null;
}

// A textarea only ever holds plain text — the clipboard's HTML flavor has to
// be captured here instead, since it's discarded by native paste.
function onSnippetPaste(event: ClipboardEvent) {
  snippetHtml.value = event.clipboardData?.getData("text/html") || null;
}

function onFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null;
  handleFile(file);
}

function handleFile(file: File | null) {
  error.value = null;
  if (!file) {
    selectedFile.value = null;
    return;
  }

  const kind = detectFileKind(file.name);
  if (!kind) {
    selectedFile.value = null;
    error.value = "Unsupported file type. Use .md, .markdown, .docx, or .pdf.";
    return;
  }
  if (file.size > maxBytesForFileKind(kind)) {
    selectedFile.value = null;
    error.value = `File exceeds the ${FILE_KIND_LIMIT_LABEL[kind]} limit for this type.`;
    return;
  }

  selectedFile.value = file;
}

function openFilePicker() {
  fileInput.value?.click();
}

function onDragEnter(event: DragEvent) {
  event.preventDefault();
  dragDepth.value += 1;
  isDragging.value = true;
}

function onDragOver(event: DragEvent) {
  event.preventDefault();
}

function onDragLeave(event: DragEvent) {
  event.preventDefault();
  dragDepth.value = Math.max(0, dragDepth.value - 1);
  if (dragDepth.value === 0) isDragging.value = false;
}

function onDrop(event: DragEvent) {
  event.preventDefault();
  dragDepth.value = 0;
  isDragging.value = false;
  const file = event.dataTransfer?.files?.[0] ?? null;
  handleFile(file);
}

async function onSubmit() {
  if (mode.value === "snippet") {
    await onSubmitSnippet();
  } else if (mode.value === "file") {
    await onSubmitFile();
  } else {
    await onSubmitUrl();
  }
}

async function onSubmitUrl() {
  submitting.value = true;
  error.value = null;
  try {
    const result = await store.add(url.value);
    if (result.duplicate) {
      duplicate.value = true;
      return;
    }
    if (result.error) {
      error.value = result.error;
      return;
    }
    isOpen.value = false;
  } finally {
    submitting.value = false;
  }
}

async function onSubmitSnippet() {
  submitting.value = true;
  error.value = null;
  try {
    const result = snippetHtml.value
      ? await store.addSnippet(snippetHtml.value, snippetText.value)
      : await store.addNote(snippetText.value);
    if (result.error) {
      error.value = result.error;
      return;
    }
    isOpen.value = false;
  } finally {
    submitting.value = false;
  }
}

async function onSubmitFile() {
  const file = selectedFile.value;
  if (!file) return;

  submitting.value = true;
  error.value = null;
  try {
    const result =
      detectFileKind(file.name) === "pdf" ? await store.addPdf(file) : await store.addFile(file);
    if (result.error) {
      error.value = result.error;
      return;
    }
    isOpen.value = false;
  } finally {
    submitting.value = false;
  }
}

function cancelDuplicate() {
  duplicate.value = false;
}

async function confirmDuplicate() {
  submitting.value = true;
  try {
    const result = await store.add(url.value, { force: true });
    if (result.error) {
      duplicate.value = false;
      error.value = result.error;
      return;
    }
    isOpen.value = false;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <button class="btn btn-primary add-btn" type="button" @click="open">Add</button>

  <div v-if="isOpen" class="backdrop" @click.self="cancel">
    <dialog open class="dialog">
      <div v-if="duplicate" class="duplicate-confirm">
        <p class="confirm-message">This URL is already saved. Add it again?</p>
        <div class="dialog-actions">
          <button class="btn btn-secondary cancel-btn" type="button" @click="cancelDuplicate">
            Cancel
          </button>
          <button
            class="btn btn-primary confirm-btn"
            type="button"
            :disabled="submitting"
            @click="confirmDuplicate"
          >
            Add anyway
          </button>
        </div>
      </div>
      <form v-else @submit.prevent="onSubmit">
        <div class="mode-switch">
          <button
            type="button"
            class="mode-btn mode-url"
            :class="{ active: mode === 'url' }"
            @click="setMode('url')"
          >
            URL
          </button>
          <button
            type="button"
            class="mode-btn mode-snippet"
            :class="{ active: mode === 'snippet' }"
            @click="setMode('snippet')"
          >
            Snippet
          </button>
          <button
            type="button"
            class="mode-btn mode-file"
            :class="{ active: mode === 'file' }"
            @click="setMode('file')"
          >
            File
          </button>
        </div>

        <template v-if="mode === 'url'">
          <label class="field-label" for="bookmark-url">URL</label>
          <input
            id="bookmark-url"
            v-model="url"
            type="url"
            placeholder="https://example.com/article"
            class="field-input"
            required
            autofocus
          />
        </template>
        <template v-else-if="mode === 'snippet'">
          <label class="field-label" for="bookmark-snippet">Snippet</label>
          <textarea
            id="bookmark-snippet"
            v-model="snippetText"
            class="field-input snippet-input"
            placeholder="Paste or type a snippet"
            autofocus
            @paste="onSnippetPaste"
          ></textarea>
        </template>
        <template v-else>
          <label class="field-label" for="bookmark-file">File</label>
          <div
            class="dropzone"
            :class="{ dragging: isDragging, filled: selectedFile }"
            tabindex="0"
            role="button"
            aria-label="Choose a file or drop it here"
            autofocus
            @click="openFilePicker"
            @keydown.enter="openFilePicker"
            @keydown.space.prevent="openFilePicker"
            @dragenter="onDragEnter"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @drop="onDrop"
          >
            <input
              id="bookmark-file"
              ref="fileInput"
              type="file"
              class="file-input-hidden"
              accept=".md,.markdown,.docx,.pdf"
              tabindex="-1"
              @change="onFileChange"
              @click.stop
            />
            <svg
              class="dropzone-icon"
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path d="M12 15V3m0 0 4 4m-4-4-4 4" stroke-linecap="round" stroke-linejoin="round" />
              <path
                d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <p v-if="selectedFile" class="dropzone-filename">{{ selectedFile.name }}</p>
            <p v-else class="dropzone-text">
              <span class="dropzone-link">Click to upload</span> or drag and drop
            </p>
            <p class="file-hint">
              Markdown (.md, up to 500KB), Word (.docx, up to 5MB), or PDF (up to 20MB)
            </p>
          </div>
        </template>

        <p v-if="error" class="error">{{ error }}</p>
        <div class="dialog-actions">
          <button class="btn btn-secondary cancel-btn" type="button" @click="cancel">Cancel</button>
          <button
            class="btn btn-primary submit-btn"
            type="submit"
            :disabled="
              submitting ||
              (mode === 'snippet' && !snippetText.trim()) ||
              (mode === 'file' && !selectedFile)
            "
          >
            Add
          </button>
        </div>
      </form>
    </dialog>
  </div>
</template>

<style scoped>
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

.btn-primary:disabled {
  opacity: 0.6;
  cursor: default;
}

.backdrop {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 40%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.dialog {
  border: none;
  border-radius: var(--rl-radius);
  background: var(--rl-surface);
  color: var(--rl-text-primary);
  padding: 24px;
  width: 320px;
  max-width: calc(100vw - 32px);
}

.mode-switch {
  display: flex;
  border-radius: var(--rl-radius);
  border: 0.5px solid var(--rl-border);
  padding: 2px;
  margin-bottom: 16px;
}

.mode-btn {
  flex: 1;
  background: transparent;
  border: none;
  border-radius: calc(var(--rl-radius) - 2px);
  color: var(--rl-text-secondary);
  font-size: 13px;
  height: 28px;
  cursor: pointer;
}

.mode-btn.active {
  background: var(--rl-accent);
  color: var(--rl-on-accent);
  font-weight: 500;
}

.field-label {
  font-size: 12px;
  color: var(--rl-text-secondary);
  display: block;
  margin-bottom: 4px;
}

.field-input {
  width: 100%;
  height: 40px;
  border-radius: var(--rl-radius);
  border: 0.5px solid var(--rl-border);
  background: var(--rl-bg);
  color: var(--rl-text-primary);
  padding: 0 12px;
  font-size: 14px;
  box-sizing: border-box;
}

.snippet-input {
  height: 120px;
  padding: 8px 12px;
  resize: vertical;
  font-family: inherit;
}

.file-input-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  min-height: 140px;
  border-radius: var(--rl-radius);
  border: 1px dashed var(--rl-border);
  background: var(--rl-bg);
  color: var(--rl-text-secondary);
  padding: 20px 16px;
  box-sizing: border-box;
  cursor: pointer;
  text-align: center;
  transition:
    border-color 0.15s,
    background 0.15s;
}

.dropzone:hover,
.dropzone:focus-visible {
  border-color: var(--rl-accent);
}

.dropzone:focus-visible {
  outline: 2px solid var(--rl-accent);
  outline-offset: 2px;
}

.dropzone.dragging {
  border-color: var(--rl-accent);
  border-style: solid;
  background: color-mix(in srgb, var(--rl-accent) 8%, var(--rl-bg));
}

.dropzone.filled {
  border-style: solid;
  border-color: var(--rl-accent);
}

.dropzone-icon {
  color: var(--rl-text-secondary);
  margin-bottom: 4px;
}

.dropzone.filled .dropzone-icon,
.dropzone.dragging .dropzone-icon {
  color: var(--rl-accent);
}

.dropzone-text {
  font-size: 13px;
  margin: 0;
}

.dropzone-link {
  color: var(--rl-accent);
  font-weight: 500;
}

.dropzone-filename {
  font-size: 13px;
  font-weight: 500;
  color: var(--rl-text-primary);
  margin: 0;
  word-break: break-all;
}

.file-hint {
  font-size: 11px;
  color: var(--rl-text-secondary);
  margin: 8px 0 0;
}

.error {
  color: var(--rl-accent);
  font-size: 13px;
  margin: 8px 0 0;
}

.confirm-message {
  font-size: 14px;
  color: var(--rl-text-primary);
  margin: 0;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
