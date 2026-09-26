<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from "vue";
import { useRouter } from "vue-router";
import { IconLoader2, IconAlertTriangle, IconRefresh } from "@tabler/icons-vue";
import { useBookmarksStore } from "../stores/bookmarks";
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

const props = defineProps<{
  id: string;
}>();

const router = useRouter();
const store = useBookmarksStore();
const offlineCache = useOfflineCacheStore();

const bookmark = computed(() => store.bookmarks.find((b) => b.id === props.id) ?? null);
const byline = computed(() => (bookmark.value ? readerByline(bookmark.value) : ""));
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

function flushProgress() {
  const session = progressSession;
  if (!session || session.pending === null) return;
  const value = session.pending;
  session.pending = null;
  session.lastWritten = value;
  store.updateProgress(session.id, value);
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

onMounted(() => window.addEventListener("pagehide", onPageHide));
onUnmounted(() => {
  window.removeEventListener("pagehide", onPageHide);
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
  if (!bookmark.value || bookmark.value.content_md === undefined) {
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

async function onRetry() {
  await store.refresh(props.id);
}

function onBack() {
  router.push({ name: "list" });
}

async function onArchive() {
  await store.archive(props.id);
  router.push({ name: "list" });
}

function onDelete() {
  store.remove(props.id);
  router.push({ name: "list" });
}

function onMarkRead() {
  store.markRead(props.id);
}

function onMarkUnread() {
  store.markUnread(props.id);
}

const showShareDialog = ref(false);

function onTogglePublic(isPublic: boolean) {
  if (bookmark.value) store.setPublic(bookmark.value.id, isPublic);
}

function onAddTag(name: string) {
  if (bookmark.value) store.addTag(bookmark.value.id, name);
}

function onRemoveTag(tagId: string) {
  if (bookmark.value) store.removeTag(bookmark.value.id, tagId);
}

// What the content area is doing, as one value — so it can't be editing and
// translating at once, and a translation can only land on the bookmark it
// was started for.
// - reading: `view` is which body to show when a cached translation exists
//   (translated by default); `error` is the last translation failure.
// - translating: waiting on DeepL for `forId`.
// - editing: the title/body drafts.
type ContentMode =
  | { kind: "reading"; view: "translated" | "original"; error: string | null }
  | { kind: "translating"; forId: string }
  | { kind: "editing"; title: string; content: string };

const READING: ContentMode = { kind: "reading", view: "translated", error: null };
const mode = shallowRef<ContentMode>(READING);

const editing = computed(() => mode.value.kind === "editing");
const translating = computed(() => mode.value.kind === "translating");
const translateError = computed(() => (mode.value.kind === "reading" ? mode.value.error : null));
const showOriginal = computed(
  () => mode.value.kind === "reading" && mode.value.view === "original",
);

const draftTitle = computed({
  get: () => (mode.value.kind === "editing" ? mode.value.title : ""),
  set: (title: string) => {
    if (mode.value.kind === "editing") mode.value = { ...mode.value, title };
  },
});
const draftContent = computed({
  get: () => (mode.value.kind === "editing" ? mode.value.content : ""),
  set: (content: string) => {
    if (mode.value.kind === "editing") mode.value = { ...mode.value, content };
  },
});

// Editing is allowed while a translation is in flight: the pending result is
// then dropped (the mode is no longer "translating"), and the store discards
// a translation whose source text has since changed.
function onEdit() {
  if (!bookmark.value || mode.value.kind === "editing") return;
  mode.value = {
    kind: "editing",
    title: bookmark.value.title ?? "",
    content: bookmark.value.content_md ?? "",
  };
}

function onCancelEdit() {
  mode.value = READING;
}

async function onSaveEdit() {
  const current = mode.value;
  if (!bookmark.value || current.kind !== "editing") return;
  const words = wordCount(current.content);
  await store.updateContent(bookmark.value.id, {
    title: current.title,
    content_md: current.content,
    word_count: words,
    reading_time: readingTimeFromWordCount(words),
  });
  mode.value = READING;
}

const displayContentMd = computed(() => {
  if (!bookmark.value) return null;
  if (showOriginal.value || !bookmark.value.translated_content_md) return bookmark.value.content_md;
  return bookmark.value.translated_content_md;
});

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

function onToggleOriginal() {
  if (mode.value.kind !== "reading") return;
  mode.value = { ...mode.value, view: mode.value.view === "original" ? "translated" : "original" };
}

// PDFs: view_mode is the persisted user choice; absent that, default to
// markdown when extraction succeeded, else fall back to the original.
const pdfSignedUrl = ref<string | null>(null);

const pdfEffectiveViewMode = computed<"markdown" | "original">(() => {
  if (!bookmark.value || bookmark.value.type !== "pdf") return "markdown";
  if (bookmark.value.view_mode) return bookmark.value.view_mode;
  return bookmark.value.pdf_parsed ? "markdown" : "original";
});

// Both views are only available once parsing succeeded and the original
// hasn't been trashed — otherwise there's only one view to show, forced.
const canTogglePdfView = computed(
  () => bookmark.value?.type === "pdf" && bookmark.value.pdf_parsed && !!bookmark.value.pdf_path,
);

const showPdfOriginal = computed(
  () =>
    bookmark.value?.type === "pdf" &&
    !!bookmark.value.pdf_path &&
    pdfEffectiveViewMode.value === "original",
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

function onTogglePdfView() {
  if (!bookmark.value) return;
  const next = pdfEffectiveViewMode.value === "markdown" ? "original" : "markdown";
  store.setViewMode(bookmark.value.id, next);
}

async function onOpenOriginalPdf() {
  if (!bookmark.value?.pdf_path) return;
  const { url: signedUrl } = await store.getPdfSignedUrl(bookmark.value.pdf_path);
  if (signedUrl) window.open(signedUrl, "_blank", "noopener");
}

async function onTrashOriginalPdf() {
  if (!bookmark.value) return;
  await store.trashOriginalPdf(bookmark.value.id);
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
  <main v-if="bookmark" class="mx-auto flex h-full max-w-680 flex-col bg-raised">
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
      <template v-if="bookmark.status === 'ready' && bodyLoaded">
        <h1
          data-testid="title"
          v-if="!editing"
          class="m-0 mb-8 font-sans text-xl leading-[1.3] font-medium text-ink"
        >
          {{ bookmark.title }}
        </h1>
        <input
          data-testid="title-input"
          v-else
          v-model="draftTitle"
          class="m-0 mb-12 w-full rounded-md border-[0.5px] border-line bg-raised px-10 py-8 font-sans text-xl leading-[normal] font-medium text-ink"
          type="text"
          placeholder="Title"
        />
        <p v-if="byline && !editing" class="m-0 mb-20 font-mono text-xs text-ink-faint">
          {{ byline }}
        </p>
        <div v-if="editing" class="m-0 mb-12 flex justify-end gap-8">
          <Button variant="secondary" test-id="cancel-edit-btn" @click="onCancelEdit">
            Cancel
          </Button>
          <Button test-id="save-edit-btn" @click="onSaveEdit">Save</Button>
        </div>
        <div
          data-testid="translate-bar"
          v-if="!editing && (translating || translateError || bookmark.translated_content_md)"
          class="m-0 mb-16 flex items-center gap-10 rounded-md bg-canvas px-10 py-8 font-sans text-sm"
        >
          <span v-if="translating" class="text-ink-muted">Translating…</span>
          <span v-else-if="translateError" class="text-danger">{{ translateError }}</span>
          <template v-else>
            <span class="text-ink-muted">{{ showOriginal ? "Original" : "Translated" }}</span>
            <button
              data-testid="translate-toggle"
              class="cursor-pointer border-0 bg-transparent p-0 font-sans text-sm leading-[normal] text-accent"
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
          class="m-0 mb-16 flex items-center gap-10 rounded-md bg-canvas px-10 py-8 font-sans text-sm"
        >
          <span class="text-ink-muted">{{
            pdfEffectiveViewMode === "original" ? "Original PDF" : "Markdown"
          }}</span>
          <button
            data-testid="pdf-view-toggle"
            class="cursor-pointer border-0 bg-transparent p-0 font-sans text-sm leading-[normal] text-accent"
            type="button"
            @click="onTogglePdfView"
          >
            {{ pdfEffectiveViewMode === "original" ? "Show markdown" : "Show original PDF" }}
          </button>
        </div>
        <ArticleContent
          :content-md="editing ? bookmark.content_md : displayContentMd"
          :type="bookmark.type"
          :youtube-video-id="bookmark.youtube_video_id"
          :thumbnail-url="bookmark.thumbnail_url"
          :editing="editing"
          :model-value="draftContent"
          :show-pdf-original="showPdfOriginal"
          :pdf-url="pdfSignedUrl"
          @update:model-value="draftContent = $event"
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
          class="mt-8 inline-flex cursor-pointer items-center gap-8 rounded-md border-[0.5px] border-line bg-raised px-14 py-8 font-sans text-sm leading-[normal] text-ink hover:bg-canvas"
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
</template>
