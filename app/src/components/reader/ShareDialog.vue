<script setup lang="ts">
import { computed, ref } from "vue";
import { IconCopy, IconCopyCheck, IconShare2, IconX } from "@tabler/icons-vue";
import type { Bookmark } from "../../lib/supabase";

const props = defineProps<{
  bookmark: Bookmark;
  origin?: string;
}>();

const emit = defineEmits<{
  close: [];
  togglePublic: [isPublic: boolean];
}>();

const copied = ref(false);

const shareUrl = computed(() => `${props.origin ?? window.location.origin}/s/${props.bookmark.id}`);
const canNativeShare = computed(() => typeof navigator.share === "function");

function onToggle(event: Event) {
  const next = (event.target as HTMLInputElement).checked;
  // Anyone holding the (intentionally public) anon key can look up a shared
  // bookmark by this link's id — confirm before the first share, not on
  // every re-share or on unshare.
  if (next && !props.bookmark.is_public) {
    if (!window.confirm("Make this bookmark visible to anyone with the link?")) return;
  }
  emit("togglePublic", next);
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareUrl.value);
  } catch {
    const input = document.createElement("textarea");
    input.value = shareUrl.value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 2000);
}

function nativeShare() {
  navigator
    .share({ url: shareUrl.value, title: props.bookmark.title ?? undefined })
    .catch(() => {});
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Share bookmark">
      <div class="dialog-header">
        <h2 class="dialog-title">Share</h2>
        <button class="icon-btn close-btn" type="button" @click="emit('close')">
          <IconX :size="18" />
        </button>
      </div>

      <label class="toggle-row">
        <span>Public link</span>
        <input
          type="checkbox"
          class="toggle-input"
          :checked="bookmark.is_public"
          @change="onToggle"
        />
      </label>

      <template v-if="bookmark.is_public">
        <div class="link-row">
          <input
            class="link-field"
            type="text"
            readonly
            :value="shareUrl"
            @focus="($event.target as HTMLInputElement).select()"
          />
          <button class="icon-btn copy-btn" type="button" @click="copyLink">
            <IconCopyCheck v-if="copied" :size="18" />
            <IconCopy v-else :size="18" />
          </button>
        </div>
        <button
          v-if="canNativeShare"
          class="btn btn-primary share-native-btn"
          type="button"
          @click="nativeShare"
        >
          <IconShare2 :size="16" />
          Share…
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 100;
}

.dialog {
  width: 100%;
  max-width: 480px;
  background: var(--rl-surface);
  border-radius: var(--rl-radius) var(--rl-radius) 0 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dialog-title {
  font-size: 16px;
  font-weight: 500;
  margin: 0;
  color: var(--rl-text-primary);
}

.icon-btn {
  display: inline-flex;
  border: none;
  background: transparent;
  color: var(--rl-text-secondary);
  cursor: pointer;
  padding: 0;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  color: var(--rl-text-primary);
}

.link-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.link-field {
  flex: 1;
  min-width: 0;
  font-family: var(--rl-font-mono);
  font-size: 12px;
  padding: 8px 10px;
  border-radius: var(--rl-radius);
  border: 0.5px solid var(--rl-border);
  background: transparent;
  color: var(--rl-text-primary);
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 34px;
  padding: 0 14px;
  border-radius: var(--rl-radius);
  font-size: 13px;
  cursor: pointer;
  border: none;
}

.btn-primary {
  background: var(--rl-accent);
  color: var(--rl-on-accent);
  font-weight: 500;
}
</style>
