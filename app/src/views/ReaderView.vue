<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from "vue";
import { useRouter } from "vue-router";
import { IconLoader2, IconAlertTriangle, IconRefresh } from "@tabler/icons-vue";
import type { Bookmark } from "../lib/supabase";
import { useBookmarksStore, type WriteResult } from "../stores/bookmarks";
import { useOfflineCacheStore } from "../stores/offlineCache";
import { useScrollProgress } from "../composables/useScrollProgress";
import { useDebouncedFn } from "../composables/useDebouncedFn";
import { readerByline } from "../utils/format";
import { readingTimeFromWordCount, wordCount } from "../utils/reading";
import ReaderHeader from "../components/reader/ReaderHeader.vue";
import ReaderProgressBar from "../components/reader/ReaderProgressBar.vue";
import ArticleContent from "../components/reader/ArticleContent.vue";
import ShareDialog from "../components/reader/ShareDialog.vue";
import TagInput from "../components/reader/TagInput.vue";
import Button from "../shared/ui/Button.vue";
import Message from "../shared/ui/Message.vue";

const props = defineProps<{
  id: string;
}>();

const router = useRouter();
const store = useBookmarksStore();
const offlineCache = useOfflineCacheStore();

const bookmark = computed(() => store.bookmarks.find((b) => b.id === props.id) ?? null);
// The list query omits article bodies, so a row that arrived via the list has
// `content_md === undefined` until fetchOne() pulls the full record. Once
// loaded it is a string (or null for a body-less type), never undefined.
const awaitingBody = ref(false);
const bodyLoaded = computed(
  () => bookmark.value !== null && bookmark.value.content_md !== undefined && !awaitingBody.value,
);

const scrollContainer = useTemplateRef<HTMLDivElement>("scrollContainer");
const { progress } = useScrollProgress(scrollContainer);

// Reading progress for the bookmark on screen. One record owns it so a
// position can only be restored once there's a body to scroll, and a pending
// write always lands on the bookmark it was read on:
// - "awaiting-body": the body (or a ready status) isn't there yet — the
//   container only holds a placeholder, so scrolls are meaningless.
// - "tracking": the saved position has been restored; scrolls are recorded.
type ProgressSession = {
  id: string;
  phase: "awaiting-body" | "tracking";
  // Last value persisted (or restored) — the guard for coalescing writes.
  lastWritten: number;
  pending: number | null;
};
let progressSession: ProgressSession | null = null;

// Reading progress is a nice-to-have, not something worth a DB write on every
// debounce tick of a long scroll: coalesce to one write per 2s, only when the
// position moved a meaningful amount, and flush whatever is pending when the
// page goes away or the reader switches bookmarks.
const PROGRESS_WRITE_DELTA = 0.02;

// Resolves to whether the write landed (true when there was nothing to write).
async function flushProgress(): Promise<boolean> {
  const session = progressSession;
  if (!session || session.pending === null) return true;
  const value = session.pending;
  session.pending = null;
  session.lastWritten = value;
  const { error } = await store.updateProgress(session.id, value);
  return error === null;
}

const flushProgressDebounced = useDebouncedFn(flushProgress, 2000);

function restoreScroll(target: number) {
  nextTick(() => {
    requestAnimationFrame(() => {
      const el = scrollContainer.value;
      if (!el) return;
      const scrollable = el.scrollHeight - el.clientHeight;
      if (scrollable > 0) el.scrollTop = Math.round(target * scrollable);
    });
  });
}

function syncProgressSession() {
  const current = bookmark.value;
  if (!current) return;

  if (progressSession?.id !== current.id) {
    flushProgress();
    progressSession = { id: current.id, phase: "awaiting-body", lastWritten: 0, pending: null };
  }

  const readable = current.status === "ready" && bodyLoaded.value && scrollContainer.value;
  if (!readable) {
    // Body is being (re)loaded, e.g. pending → ready: keep what was read so
    // far, then restore again once the new body renders.
    flushProgress();
    progressSession.phase = "awaiting-body";
    return;
  }
  if (progressSession.phase === "tracking") return;

  progressSession.phase = "tracking";
  const target = current.progress ?? 0;
  // The restore scroll re-fires the progress watcher; treat the restored
  // value as already persisted so it doesn't trigger a redundant write.
  progressSession.lastWritten = target;
  if (target > 0) restoreScroll(target);
}

watch(
  () => [bookmark.value?.id, bookmark.value?.status, bodyLoaded.value, scrollContainer.value],
  syncProgressSession,
  { immediate: true },
);

watch(progress, (newVal) => {
  const session = progressSession;
  if (!session || session.phase !== "tracking") return;
  if (Math.abs(newVal - session.lastWritten) < PROGRESS_WRITE_DELTA) return;
  session.pending = newVal;
  flushProgressDebounced();
});

function onPageHide() {
  flushProgress();
}

// The reader stays open across app switches, and a backgrounded tab or PWA
// (iOS suspends it, Realtime socket included) misses positions saved on
// another device meanwhile. On return: send what this device still owes, then
// move to the saved position if it's elsewhere. Only while tracking — before
// that the restore reads the row fresh anyway.
async function catchUpProgress() {
  const session = progressSession;
  if (!session || session.phase !== "tracking" || !navigator.onLine) return;
  const tracking = () => progressSession === session && session.phase === "tracking";
  // Something still unsent means this device has the newest position.
  if (!(await flushProgress()) || !(await store.sendUnsentProgress())) return;
  const row = await store.fetchOne(session.id);
  if (!row || !tracking() || session.pending !== null) return;
  const target = row.progress ?? 0;
  if (Math.abs(target - progress.value) < PROGRESS_WRITE_DELTA) return;
  session.lastWritten = target;
  restoreScroll(target);
}

// iOS often skips pagehide when a PWA is swiped away — hidden is the last
// reliable moment to write.
function onVisibilityChange() {
  if (document.visibilityState === "hidden") flushProgress();
  else catchUpProgress();
}

// Offline, the reader shows the cached copy; images it couldn't save
// (CORS-blocked hot links) render broken, so say how many up front.
const online = ref(typeof navigator === "undefined" || navigator.onLine);
function onConnectivityChange() {
  online.value = navigator.onLine;
  if (online.value) catchUpProgress();
}
const imagesNotCachedNote = computed(() => {
  const count = online.value ? 0 : offlineCache.missingImageCount(props.id);
  if (count === 0) return null;
  return count === 1
    ? "1 image wasn't saved for offline reading."
    : `${count} images weren't saved for offline reading.`;
});

onMounted(() => {
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("online", onConnectivityChange);
  window.addEventListener("offline", onConnectivityChange);
});
onUnmounted(() => {
  window.removeEventListener("pagehide", onPageHide);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("online", onConnectivityChange);
  window.removeEventListener("offline", onConnectivityChange);
  flushProgress();
});

// The list query carries no article bodies, so pull the full row when the
// store only holds a body-less list projection (content_md === undefined).
async function loadFullRow() {
  awaitingBody.value = true;
  try {
    await store.fetchOne(props.id);
  } finally {
    awaitingBody.value = false;
  }
}

onMounted(async () => {
  // Realtime keeps the row live while the reader is open — a pending article
  // finishing on the worker lands here without polling.
  store.subscribeToChanges();
  // Offline, a row loaded online this session still points its images at
  // their original hosts; re-read the downloaded copy so they come from the
  // stored blobs instead.
  const offlineWithCopy = !navigator.onLine && offlineCache.isCached(props.id);
  if (!bookmark.value || bookmark.value.content_md === undefined || offlineWithCopy) {
    await loadFullRow();
  }
  if (bookmark.value?.status === "ready") {
    offlineCache.cacheBookmark(bookmark.value).catch(() => {});
  }
});

// A Realtime UPDATE can flip status pending → ready while the reader is open;
// the payload carries no body, so fetch the full row (and cache it) once it
// exists.
watch(
  () => bookmark.value?.status,
  async (status, previous) => {
    if (status === "ready" && previous && previous !== "ready") {
      await loadFullRow();
      if (bookmark.value) offlineCache.cacheBookmark(bookmark.value).catch(() => {});
    }
  },
);

// The last failed write (archive, delete, mark read, tag, share, edit…). The
// store leaves local state untouched on failure, so the screen still shows
// what the server has; this tells the user the action didn't happen.
const actionError = ref<string | null>(null);

async function run(write: Promise<WriteResult>): Promise<boolean> {
  const { error } = await write;
  actionError.value = error;
  return error === null;
}

async function onRetry() {
  await run(store.refresh(props.id));
}

function onBack() {
  router.push({ name: "list" });
}

async function onArchive() {
  if (await run(store.archive(props.id))) router.push({ name: "list" });
}

// Doesn't wait for the server: the row leaves the list at once and comes back
// if the delete fails (see store.remove).
function onDelete() {
  store.remove(props.id);
  router.push({ name: "list" });
}

function onMarkRead() {
  run(store.markRead(props.id));
}

function onMarkUnread() {
  run(store.markUnread(props.id));
}

const showShareDialog = ref(false);

function onTogglePublic(isPublic: boolean) {
  run(store.setPublic(props.id, isPublic));
}

function onAddTag(name: string) {
  run(store.addTag(props.id, name));
}

function onRemoveTag(tagId: string) {
  run(store.removeTag(props.id, tagId));
}

// What the content area is doing, as one value — so it can't be editing and
// translating at once, and a translation can only land on the bookmark it
// was started for.
// - reading: `view` is which body to show when a cached translation exists
//   (translated by default); `error` is the last translation failure.
// - translating: waiting on DeepL for `forId`.
// - editing: `draft` holds the title/body being edited.
type ContentMode =
  | { kind: "reading"; view: "translated" | "original"; error: string | null }
  | { kind: "translating"; forId: string }
  | { kind: "editing" };

const READING: ContentMode = { kind: "reading", view: "translated", error: null };
const mode = shallowRef<ContentMode>(READING);

const editing = computed(() => mode.value.kind === "editing");
const translating = computed(() => mode.value.kind === "translating");
const translateError = computed(() => (mode.value.kind === "reading" ? mode.value.error : null));
const showOriginal = computed(
  () => mode.value.kind === "reading" && mode.value.view === "original",
);

// Only meaningful while editing; onEdit seeds it from the bookmark.
const draft = reactive({ title: "", content: "" });

// Editing is allowed while a translation is in flight: the pending result is
// then dropped (the mode is no longer "translating"), and the store discards
// a translation whose source text has since changed.
function onEdit() {
  if (!bookmark.value || mode.value.kind === "editing") return;
  draft.title = bookmark.value.title ?? "";
  draft.content = bookmark.value.content_md ?? "";
  mode.value = { kind: "editing" };
}

function onCancelEdit() {
  mode.value = READING;
}

// The Save button only renders while editing, so the draft is current.
async function onSaveEdit() {
  const words = wordCount(draft.content);
  const saved = await run(
    store.updateContent(props.id, {
      title: draft.title,
      content_md: draft.content,
      word_count: words,
      reading_time: readingTimeFromWordCount(words),
    }),
  );
  // Keep the editor (and the draft) open when the save failed.
  if (saved) mode.value = READING;
}

// The editor always starts from the original; otherwise a cached
// translation is shown unless the reader asked for the original.
function displayedBody(b: Bookmark): string | null {
  if (editing.value || showOriginal.value || !b.translated_content_md) return b.content_md;
  return b.translated_content_md;
}

async function onTranslate() {
  const current = bookmark.value;
  if (!current?.content_md || mode.value.kind !== "reading") return;
  // Already translated and cached server-side — just make sure it's shown,
  // without spending another DeepL call.
  if (current.translated_content_md) {
    mode.value = READING;
    return;
  }
  mode.value = { kind: "translating", forId: current.id };
  const targetLang = (navigator.language.split("-")[0] || "en").toUpperCase();
  const { error } = await store.translateBookmark(current.id, current.content_md, targetLang);
  // Superseded: the user started editing or switched bookmarks meanwhile.
  if (mode.value.kind !== "translating" || mode.value.forId !== props.id) return;
  mode.value = { kind: "reading", view: "translated", error };
}

// The toggle only renders while reading a translation with no error showing.
function onToggleOriginal() {
  mode.value = {
    kind: "reading",
    view: showOriginal.value ? "translated" : "original",
    error: null,
  };
}

// PDFs: view_mode is the persisted user choice; absent that, default to
// markdown when extraction succeeded, else fall back to the original.
const pdfSignedUrl = ref<string | null>(null);

function pdfViewMode(pdf: Bookmark): "markdown" | "original" {
  return pdf.view_mode ?? (pdf.pdf_parsed ? "markdown" : "original");
}

// Both views are only available once parsing succeeded and the original
// hasn't been trashed — otherwise there's only one view to show, forced.
const canTogglePdfView = computed(
  () => bookmark.value?.type === "pdf" && bookmark.value.pdf_parsed && !!bookmark.value.pdf_path,
);

const showPdfOriginal = computed(
  () =>
    bookmark.value?.type === "pdf" &&
    !!bookmark.value.pdf_path &&
    pdfViewMode(bookmark.value) === "original",
);

watch(
  showPdfOriginal,
  async (show) => {
    if (!show || !bookmark.value?.pdf_path) {
      pdfSignedUrl.value = null;
      return;
    }
    const { url: signedUrl } = await store.getPdfSignedUrl(bookmark.value.pdf_path);
    pdfSignedUrl.value = signedUrl;
  },
  { immediate: true },
);

// The toggle only renders for a PDF that has both views.
function onTogglePdfView() {
  run(store.setViewMode(props.id, showPdfOriginal.value ? "markdown" : "original"));
}

async function onOpenOriginalPdf() {
  if (!bookmark.value?.pdf_path) return;
  const { url: signedUrl } = await store.getPdfSignedUrl(bookmark.value.pdf_path);
  if (signedUrl) window.open(signedUrl, "_blank", "noopener");
}

async function onTrashOriginalPdf() {
  await store.trashOriginalPdf(props.id);
}

watch(
  () => props.id,
  () => {
    mode.value = READING;
    pdfSignedUrl.value = null;
  },
);
</script>

<template>
  <main
    v-if="bookmark"
    class="mx-auto flex h-full max-w-680 flex-col bg-raised sm:border-x sm:border-line"
  >
    <ReaderProgressBar :progress="progress" />
    <ReaderHeader
      :bookmark="bookmark"
      @back="onBack"
      @archive="onArchive"
      @delete="onDelete"
      @share="showShareDialog = true"
      @mark-read="onMarkRead"
      @mark-unread="onMarkUnread"
      @edit="onEdit"
      @translate="onTranslate"
      @open-original-pdf="onOpenOriginalPdf"
      @trash-original-pdf="onTrashOriginalPdf"
    />
    <div
      data-testid="scroll-area"
      ref="scrollContainer"
      class="flex-1 overflow-y-auto px-20 pt-20 pb-8"
    >
      <Message
        v-if="actionError"
        tone="danger"
        test-id="action-error"
        class="mb-16 rounded-sm border border-line bg-canvas px-10 py-8"
      >
        {{ actionError }}
      </Message>
      <template v-if="bookmark.status === 'ready' && bodyLoaded">
        <h1
          data-testid="title"
          v-if="!editing"
          class="m-0 mb-8 font-sans text-xl leading-[1.2] font-medium tracking-tight text-ink"
        >
          {{ bookmark.title }}
        </h1>
        <input
          data-testid="title-input"
          v-else
          v-model="draft.title"
          class="m-0 mb-12 w-full rounded-sm border border-line bg-recessed px-10 py-8 font-sans text-xl leading-[normal] font-medium tracking-tight text-ink focus:border-ink focus:outline-none"
          type="text"
          placeholder="Title"
        />
        <p v-if="!editing && readerByline(bookmark)" class="label m-0 mb-20 text-ink-muted">
          {{ readerByline(bookmark) }}
        </p>
        <div v-if="editing" class="m-0 mb-12 flex justify-end gap-8">
          <Button variant="secondary" test-id="cancel-edit-btn" @click="onCancelEdit">
            Cancel
          </Button>
          <Button test-id="save-edit-btn" @click="onSaveEdit">Save</Button>
        </div>
        <div
          v-if="!editing && imagesNotCachedNote"
          data-testid="images-not-cached"
          class="m-0 mb-16 rounded-sm border border-line bg-canvas px-10 py-8 font-sans text-sm text-ink-muted"
        >
          {{ imagesNotCachedNote }}
        </div>
        <div
          data-testid="translate-bar"
          v-if="!editing && (translateError || translating || bookmark.translated_content_md)"
          class="m-0 mb-16 flex items-center gap-10 rounded-sm border border-line bg-canvas px-10 py-8 font-sans text-sm"
        >
          <span v-if="translating" class="text-ink-muted">Translating…</span>
          <span v-else-if="translateError" class="text-danger">{{ translateError }}</span>
          <template v-else>
            <span class="text-ink-muted">{{ showOriginal ? "Original" : "Translated" }}</span>
            <button
              data-testid="translate-toggle"
              class="cursor-pointer border-0 bg-transparent p-0 font-sans text-sm leading-[normal] text-ink underline underline-offset-2"
              type="button"
              @click="onToggleOriginal"
            >
              {{ showOriginal ? "Show translation" : "Show original" }}
            </button>
          </template>
        </div>
        <div
          data-testid="pdf-view-bar"
          v-if="!editing && canTogglePdfView"
          class="m-0 mb-16 flex items-center gap-10 rounded-sm border border-line bg-canvas px-10 py-8 font-sans text-sm"
        >
          <span class="text-ink-muted">{{ showPdfOriginal ? "Original PDF" : "Markdown" }}</span>
          <button
            data-testid="pdf-view-toggle"
            class="cursor-pointer border-0 bg-transparent p-0 font-sans text-sm leading-[normal] text-ink underline underline-offset-2"
            type="button"
            @click="onTogglePdfView"
          >
            {{ showPdfOriginal ? "Show markdown" : "Show original PDF" }}
          </button>
        </div>
        <ArticleContent
          :content-md="displayedBody(bookmark)"
          :type="bookmark.type"
          :youtube-video-id="bookmark.youtube_video_id"
          :thumbnail-url="bookmark.thumbnail_url"
          :editing="editing"
          :model-value="draft.content"
          :show-pdf-original="showPdfOriginal"
          :pdf-url="pdfSignedUrl"
          @update:model-value="draft.content = $event"
        />
      </template>
      <div
        data-testid="status-placeholder"
        v-else-if="bookmark.status === 'failed'"
        class="flex flex-col items-center gap-12 px-16 py-64 text-center text-ink-faint"
      >
        <IconAlertTriangle :size="28" class="text-danger" />
        <p class="m-0 font-sans text-base">Couldn't process this article.</p>
        <p v-if="bookmark.error_message" class="m-0 max-w-480 font-mono text-xs text-ink-faint">
          {{ bookmark.error_message }}
        </p>
        <button
          data-testid="retry-btn"
          class="mt-8 inline-flex cursor-pointer items-center gap-8 rounded-sm border border-line-strong bg-transparent px-14 py-8 font-mono text-xs uppercase tracking-meta leading-[normal] text-ink transition-colors duration-(--duration) hover:bg-recessed"
          type="button"
          @click="onRetry"
        >
          <IconRefresh :size="16" />
          Try again
        </button>
      </div>
      <div
        data-testid="status-placeholder"
        v-else
        class="flex flex-col items-center gap-12 px-16 py-64 text-center text-ink-faint"
      >
        <IconLoader2 :size="28" class="animate-spin" />
        <p class="m-0 font-sans text-base">Processing…</p>
      </div>
    </div>
    <TagInput
      v-if="bookmark.status === 'ready'"
      :tags="bookmark.tags"
      @add="onAddTag"
      @remove="onRemoveTag"
    />
    <ShareDialog
      v-if="showShareDialog"
      :bookmark="bookmark"
      @close="showShareDialog = false"
      @toggle-public="onTogglePublic"
    />
  </main>
  <div
    v-else-if="!awaitingBody"
    data-testid="not-found"
    class="mx-auto flex h-full min-h-screen max-w-680 flex-col items-center justify-center gap-16 bg-raised px-16 text-center text-ink-faint sm:border-x sm:border-line"
  >
    <IconAlertTriangle :size="32" class="text-ink-muted" />
    <p class="m-0 font-sans text-base font-medium text-ink">Article not available offline</p>
    <p class="m-0 max-w-360 font-mono text-xs text-ink-muted">
      This bookmark is not cached locally. Connect to the internet to read it.
    </p>
    <button
      data-testid="back-to-list-btn"
      class="mt-8 inline-flex cursor-pointer items-center gap-8 rounded-sm border border-line-strong bg-transparent px-14 py-8 font-mono text-xs uppercase tracking-meta leading-[normal] text-ink transition-colors duration-(--duration) hover:bg-recessed"
      type="button"
      @click="onBack"
    >
      Back to reading list
    </button>
  </div>
  <div
    v-else
    data-testid="loading-placeholder"
    class="mx-auto flex h-full min-h-screen max-w-680 flex-col items-center justify-center gap-12 bg-raised px-16 text-center text-ink-faint sm:border-x sm:border-line"
  >
    <IconLoader2 :size="28" class="animate-spin text-ink-muted" />
    <p class="m-0 font-sans text-base">Loading…</p>
  </div>
</template>
