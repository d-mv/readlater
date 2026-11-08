<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import Toast, { type ToastTone } from "../../shared/ui/Toast.vue";
import { useUndoStore, type UndoNotice } from "../../stores/undo";

// The undo toast for archive and delete. Mounted once in App.vue, so it
// survives the reader → list navigation that follows either action.
const undo = useUndoStore();

function messageOf(notice: UndoNotice): string {
  if (notice.kind === "failed") return notice.message;
  return notice.kind === "archived" ? "Archived" : "Deleted";
}
const tone = computed<ToastTone>(() => (undo.notice?.kind === "failed" ? "danger" : "default"));
const actionLabel = computed(() =>
  undo.notice === null || undo.notice.kind === "failed" ? undefined : "Undo",
);

// A delete still in its undo window must reach the server before the app
// goes away. iOS often skips pagehide when a PWA is swiped away, so hidden
// counts too (as for reading progress in ReaderView).
function onPageHide() {
  void undo.flush();
}
function onVisibilityChange() {
  if (document.visibilityState === "hidden") void undo.flush();
}

onMounted(() => {
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibilityChange);
});
onUnmounted(() => {
  window.removeEventListener("pagehide", onPageHide);
  document.removeEventListener("visibilitychange", onVisibilityChange);
});
</script>

<template>
  <Toast
    :open="undo.notice !== null"
    :tone="tone"
    :action-label="actionLabel"
    test-id="undo-toast"
    @action="undo.undo()"
  >
    <template v-if="undo.notice">{{ messageOf(undo.notice) }}</template>
  </Toast>
</template>
