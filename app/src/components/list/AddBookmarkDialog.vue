<script setup lang="ts">
import { computed, shallowRef } from "vue";
import type { AddBookmarkResult } from "../../lib/supabase";
import { useBookmarksStore } from "../../stores/bookmarks";
import { detectFileKind, maxBytesForFileKind } from "../../utils/fileKind";
import { cn } from "../../shared/clsx";
import Button from "../../shared/ui/Button.vue";
import Dialog from "../../shared/ui/Dialog.vue";
import Input from "../../shared/ui/Input.vue";
import Message from "../../shared/ui/Message.vue";
import Tabs, { type TabOption } from "../../shared/ui/Tabs.vue";

type Mode = "url" | "snippet" | "file";

const MODE_OPTIONS: TabOption<Mode>[] = [
  { value: "url", label: "URL", testId: "mode-url" },
  { value: "snippet", label: "Snippet", testId: "mode-snippet" },
  { value: "file", label: "File", testId: "mode-file" },
];

const FILE_KIND_LIMIT_LABEL = { markdown: "500KB", docx: "5MB", pdf: "20MB" } as const;

const store = useBookmarksStore();

// The dialog's lifecycle as one value, so "closed but still submitting" or
// "duplicate prompt with an error" can't be represented. A duplicate carries
// the existing row, which is what "Add anyway" re-fetches.
type Phase =
  | { kind: "closed" }
  | { kind: "editing"; error: string | null }
  | { kind: "submitting" }
  | { kind: "confirmDuplicate"; existingId: string; submitting: boolean };

const phase = shallowRef<Phase>({ kind: "closed" });
// Bumped on every open/cancel/close: a save that started under an older
// epoch belongs to a dialog the user already dismissed, so its result is
// dropped instead of landing in the fresh form.
let epoch = 0;

const mode = shallowRef<Mode>("url");
const url = shallowRef("");
const snippetText = shallowRef("");
// The clipboard's rich-text version of a paste, paired with the exact text
// the paste left in the textarea. The HTML is only sent while the textarea
// still holds that text: after any edit (or a paste into existing text,
// where the HTML covers just a fragment) the plain text is what gets saved.
const pastedRichText = shallowRef<{ html: string; text: string } | null>(null);
const selectedFile = shallowRef<File | null>(null);
const fileInput = shallowRef<HTMLInputElement | null>(null);
const isDragging = shallowRef(false);
const dragDepth = shallowRef(0);

const isOpen = computed(() => phase.value.kind !== "closed");
const error = computed(() => (phase.value.kind === "editing" ? phase.value.error : null));
const submitting = computed(
  () =>
    phase.value.kind === "submitting" ||
    (phase.value.kind === "confirmDuplicate" && phase.value.submitting),
);

function showError(message: string | null) {
  phase.value = { kind: "editing", error: message };
}

function open() {
  epoch += 1;
  mode.value = "url";
  url.value = "";
  snippetText.value = "";
  pastedRichText.value = null;
  selectedFile.value = null;
  showError(null);
}

function close() {
  epoch += 1;
  phase.value = { kind: "closed" };
}

function setMode(next: Mode) {
  mode.value = next;
  if (phase.value.kind === "editing") showError(null);
}

// A textarea only ever holds plain text — the clipboard's HTML flavor has to
// be captured here instead, since it's discarded by native paste.
function onSnippetPaste(event: ClipboardEvent) {
  const html = event.clipboardData?.getData("text/html") ?? "";
  const plain = (event.clipboardData?.getData("text/plain") ?? "").replace(/\r\n?/g, "\n");
  const el = event.target as HTMLTextAreaElement;
  const replacesEverything =
    (el.selectionStart ?? 0) === 0 && (el.selectionEnd ?? el.value.length) === el.value.length;
  pastedRichText.value = html && replacesEverything ? { html, text: plain } : null;
}

function currentSnippetHtml(): string | null {
  const pasted = pastedRichText.value;
  return pasted && pasted.text === snippetText.value ? pasted.html : null;
}

function onFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null;
  handleFile(file);
}

function handleFile(file: File | null) {
  showError(null);
  if (!file) {
    selectedFile.value = null;
    return;
  }

  const kind = detectFileKind(file.name);
  if (!kind) {
    selectedFile.value = null;
    showError("Unsupported file type. Use .md, .markdown, .docx, or .pdf.");
    return;
  }
  if (file.size > maxBytesForFileKind(kind)) {
    selectedFile.value = null;
    showError(`File exceeds the ${FILE_KIND_LIMIT_LABEL[kind]} limit for this type.`);
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
    const html = currentSnippetHtml();
    await runSubmit(() =>
      html ? store.addSnippet(html, snippetText.value) : store.addNote(snippetText.value),
    );
  } else if (mode.value === "file") {
    const file = selectedFile.value;
    if (!file) return;
    await runSubmit(() =>
      detectFileKind(file.name) === "pdf" ? store.addPdf(file) : store.addFile(file),
    );
  } else {
    await runSubmit(() => store.add(url.value));
  }
}

// One path for every save: mark submitting, then apply the result only if the
// dialog the user submitted from is still the one on screen.
async function runSubmit(save: () => Promise<{ error: string | null } | AddBookmarkResult>) {
  const startedIn = epoch;
  phase.value = { kind: "submitting" };
  let result: { error: string | null } | AddBookmarkResult;
  try {
    result = await save();
  } catch {
    result = { error: "Something went wrong. Try again." };
  }
  if (startedIn !== epoch) return;

  if ("duplicate" in result && result.duplicate) {
    phase.value = { kind: "confirmDuplicate", existingId: result.existingId, submitting: false };
  } else if (result.error) {
    showError(result.error);
  } else {
    close();
  }
}

function cancelDuplicate() {
  showError(null);
}

// "Add anyway" on a URL that's already saved re-queues the existing bookmark
// (same as the capture popup's Continue) — inserting a second row would only
// hit the unique index on the normalized URL.
async function confirmDuplicate() {
  const current = phase.value;
  if (current.kind !== "confirmDuplicate" || current.submitting) return;
  const startedIn = epoch;
  phase.value = { ...current, submitting: true };
  await store.refresh(current.existingId);
  if (startedIn === epoch) close();
}
</script>

<template>
  <Button test-id="add-btn" @click="open">Add</Button>

  <Dialog v-if="isOpen" @close="close">
    <div v-if="phase.kind === 'confirmDuplicate'">
      <p class="m-0 text-base text-ink">This URL is already saved. Add it again?</p>
      <div class="mt-16 flex justify-end gap-8">
        <Button variant="secondary" test-id="cancel-btn" @click="cancelDuplicate">Cancel</Button>
        <Button test-id="confirm-btn" :disabled="submitting" @click="confirmDuplicate">
          Add anyway
        </Button>
      </div>
    </div>
    <form v-else @submit.prevent="onSubmit">
      <Tabs
        variant="segmented"
        :options="MODE_OPTIONS"
        :model-value="mode"
        class="mb-16"
        @update:model-value="setMode"
      />

      <template v-if="mode === 'url'">
        <label class="mb-4 block text-xs text-ink-muted" for="bookmark-url">URL</label>
        <Input
          id="bookmark-url"
          v-model="url"
          type="url"
          placeholder="https://example.com/article"
          required
          autofocus
        />
      </template>
      <template v-else-if="mode === 'snippet'">
        <label class="mb-4 block text-xs text-ink-muted" for="bookmark-snippet">Snippet</label>
        <Input
          id="bookmark-snippet"
          v-model="snippetText"
          area
          placeholder="Paste or type a snippet"
          autofocus
          @paste="onSnippetPaste"
        />
      </template>
      <template v-else>
        <label class="mb-4 block text-xs text-ink-muted" for="bookmark-file">File</label>
        <div
          data-testid="dropzone"
          :class="
            cn(
              'box-border flex min-h-140 w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-md border border-dashed border-line bg-canvas px-16 py-20 text-center text-ink-muted transition-[border-color,background] duration-150 hover:border-accent focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              isDragging && 'border-solid border-accent bg-drop-target',
              selectedFile && 'border-solid border-accent',
            )
          "
          :data-dragging="isDragging || undefined"
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
            class="sr-only"
            accept=".md,.markdown,.docx,.pdf"
            tabindex="-1"
            @change="onFileChange"
            @click.stop
          />
          <svg
            :class="cn('mb-4 text-ink-muted', (selectedFile || isDragging) && 'text-accent')"
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
          <p v-if="selectedFile" class="m-0 text-sm font-medium break-all text-ink">
            {{ selectedFile.name }}
          </p>
          <p v-else class="m-0 text-sm">
            <span class="font-medium text-accent">Click to upload</span> or drag and drop
          </p>
          <p class="mx-0 mt-8 mb-0 text-2xs text-ink-muted">
            Markdown (.md, up to 500KB), Word (.docx, up to 5MB), or PDF (up to 20MB)
          </p>
        </div>
      </template>

      <Message v-if="error" tone="accent" test-id="error" class="mt-8">{{ error }}</Message>
      <div class="mt-16 flex justify-end gap-8">
        <Button variant="secondary" test-id="cancel-btn" @click="close">Cancel</Button>
        <Button
          type="submit"
          test-id="submit-btn"
          :disabled="
            submitting ||
            (mode === 'snippet' && !snippetText.trim()) ||
            (mode === 'file' && !selectedFile)
          "
        >
          Add
        </Button>
      </div>
    </form>
  </Dialog>
</template>
