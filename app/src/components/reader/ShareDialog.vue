<script setup lang="ts">
import { computed, ref } from "vue";
import { IconCopy, IconCopyCheck, IconShare2, IconX } from "@tabler/icons-vue";
import type { Bookmark } from "../../lib/supabase";
import Button from "../../shared/ui/Button.vue";
import Dialog from "../../shared/ui/Dialog.vue";
import IconButton from "../../shared/ui/IconButton.vue";

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
  <Dialog placement="sheet" aria-label="Share bookmark" @close="emit('close')">
    <div class="flex items-center justify-between">
      <h2 class="m-0 text-md font-medium text-ink">Share</h2>
      <IconButton title="Close" test-id="close-btn" @click="emit('close')">
        <IconX :size="18" />
      </IconButton>
    </div>

    <label class="flex items-center justify-between text-base text-ink">
      <span>Public link</span>
      <input
        data-testid="toggle-input"
        type="checkbox"
        class="mt-3 mr-3 mb-3 ml-4"
        :checked="bookmark.is_public"
        @change="onToggle"
      />
    </label>

    <template v-if="bookmark.is_public">
      <div class="flex items-center gap-8">
        <input
          data-testid="link-field"
          class="min-w-0 flex-1 rounded-md border-[0.5px] border-line bg-transparent px-10 py-8 font-mono text-xs leading-[normal] text-ink"
          type="text"
          readonly
          :value="shareUrl"
          @focus="($event.target as HTMLInputElement).select()"
        />
        <IconButton title="Copy link" test-id="copy-btn" @click="copyLink">
          <IconCopyCheck v-if="copied" :size="18" />
          <IconCopy v-else :size="18" />
        </IconButton>
      </div>
      <Button v-if="canNativeShare" class="gap-8" @click="nativeShare">
        <IconShare2 :size="16" />
        Share…
      </Button>
    </template>
  </Dialog>
</template>
