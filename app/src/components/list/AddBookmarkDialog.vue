<script setup lang="ts">
import { shallowRef } from "vue";
import { useBookmarksStore } from "../../stores/bookmarks";

type Mode = "url" | "snippet";

const store = useBookmarksStore();

const isOpen = shallowRef(false);
const mode = shallowRef<Mode>("url");
const url = shallowRef("");
const snippetText = shallowRef("");
const snippetHtml = shallowRef<string | null>(null);
const error = shallowRef<string | null>(null);
const submitting = shallowRef(false);
const duplicate = shallowRef(false);

function open() {
  mode.value = "url";
  url.value = "";
  snippetText.value = "";
  snippetHtml.value = null;
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

async function onSubmit() {
  if (mode.value === "snippet") {
    await onSubmitSnippet();
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
          <button class="btn btn-secondary cancel-btn" type="button" @click="cancelDuplicate">Cancel</button>
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
        <template v-else>
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

        <p v-if="error" class="error">{{ error }}</p>
        <div class="dialog-actions">
          <button class="btn btn-secondary cancel-btn" type="button" @click="cancel">Cancel</button>
          <button
            class="btn btn-primary submit-btn"
            type="submit"
            :disabled="submitting || (mode === 'snippet' && !snippetText.trim())"
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
