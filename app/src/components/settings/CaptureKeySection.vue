<script setup lang="ts">
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  useId,
  useTemplateRef,
  watch,
} from "vue";
import { IconCopy, IconCopyCheck, IconKey } from "@tabler/icons-vue";
import { CAPTURE_ENDPOINT } from "../../lib/supabase";
import { useCaptureKey } from "../../composables/useCaptureKey";
import { copyText } from "../../utils/clipboard";
import { shortDate } from "../../utils/format";
import Button from "../../shared/ui/Button.vue";
import IconButton from "../../shared/ui/IconButton.vue";
import Input from "../../shared/ui/Input.vue";
import Message from "../../shared/ui/Message.vue";

const { state, generated, rotating, rotateError, load, rotate, dismiss } = useCaptureKey();
const headingId = useId();
const fieldId = useId();
const newKeyPanel = useTemplateRef<HTMLElement>("newKeyPanel");

const CONFIRM_TEXT =
  "Generate a new capture key?\n\nThe old key stops working; update your iOS Shortcut.";

const COPIED_MS = 2000;
const copied = shallowRef(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

function onGenerate() {
  if (!window.confirm(CONFIRM_TEXT)) return;
  void rotate();
}

async function onCopy() {
  await copyText(generated.value!);
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copied.value = false), COPIED_MS);
}

// Focus the new key's panel so assistive tech lands on it (and its label).
watch(generated, async (key) => {
  if (!key) return;
  await nextTick();
  newKeyPanel.value?.focus();
});

onMounted(load);
onBeforeUnmount(() => clearTimeout(copiedTimer));
</script>

<template>
  <section
    data-testid="capture-key"
    :aria-labelledby="headingId"
    :aria-busy="state.status === 'loading'"
    class="mb-16 rounded-sm border border-line bg-raised p-20"
  >
    <h2 :id="headingId" class="label m-0 mb-12">Capture key</h2>
    <p class="m-0 mb-16 text-sm leading-[1.5] text-ink-muted">
      The iOS Shortcut saves to Read Later with this key. Generating a new one replaces the old key
      straight away.
    </p>

    <Message v-if="state.status === 'loading'" test-id="capture-key-loading">
      Loading capture key…
    </Message>

    <template v-else-if="state.status === 'error'">
      <Message tone="danger" test-id="capture-key-error">{{ state.message }}</Message>
      <Button variant="secondary" test-id="capture-key-retry" class="mt-12" @click="load">
        Try again
      </Button>
    </template>

    <template v-else>
      <p data-testid="capture-key-status" class="m-0 mb-16 text-sm leading-[1.5] text-ink">
        <template v-if="state.key">
          <span class="font-mono text-xs text-ink-muted">
            Created {{ shortDate(state.key.created_at) }} ·
            {{
              state.key.last_used_at
                ? `Last used ${shortDate(state.key.last_used_at)}`
                : "Never used"
            }}
          </span>
        </template>
        <template v-else>
          No key yet. Until you generate one, the Shortcut can keep using the server's built-in key
          (if one is set up); your first key turns that key off.
        </template>
      </p>
      <Button test-id="capture-key-generate" :disabled="rotating" @click="onGenerate">
        <IconKey :size="16" />
        {{ rotating ? "Generating…" : state.key ? "Generate new key" : "Generate key" }}
      </Button>
      <Message v-if="rotateError" tone="danger" test-id="capture-key-rotate-error" class="mt-12">
        {{ rotateError }}
      </Message>
    </template>

    <div
      v-if="generated"
      ref="newKeyPanel"
      data-testid="capture-key-new"
      tabindex="-1"
      class="mt-16 rounded-sm border border-line-strong bg-canvas p-16"
    >
      <label :for="fieldId" class="label mb-8 block">Your new key</label>
      <div class="flex items-center gap-8">
        <Input
          :id="fieldId"
          :model-value="generated"
          readonly
          autocomplete="off"
          test-id="capture-key-value"
          class="min-w-0 flex-1 font-mono text-xs"
        />
        <IconButton title="Copy key" test-id="capture-key-copy" class="h-40 w-40" @click="onCopy">
          <IconCopyCheck v-if="copied" :size="18" />
          <IconCopy v-else :size="18" />
        </IconButton>
      </div>
      <span role="status" data-testid="capture-key-copied" class="sr-only">{{
        copied ? "Key copied" : ""
      }}</span>
      <p class="m-0 mt-8 text-sm font-medium text-ink">Copy it now — it won't be shown again.</p>

      <ol
        data-testid="capture-key-howto"
        class="m-0 mt-12 list-decimal pl-18 text-sm leading-[1.6] text-ink-muted"
      >
        <li>In the Shortcuts app, open your Read Later shortcut.</li>
        <li>
          In its <span class="text-ink">Get Contents of URL</span> action, the URL is
          <code class="font-mono text-xs break-all text-ink">{{ CAPTURE_ENDPOINT }}</code
          >, method POST.
        </li>
        <li>
          Set the header <code class="font-mono text-xs text-ink">Authorization</code> to
          <code class="font-mono text-xs text-ink">Bearer</code>, a space, then the key.
        </li>
        <li>
          The request body is JSON with <code class="font-mono text-xs text-ink">url</code> (or
          <code class="font-mono text-xs text-ink">text</code> for a note).
        </li>
      </ol>

      <Button variant="secondary" test-id="capture-key-done" class="mt-16" @click="dismiss">
        Done
      </Button>
    </div>
  </section>
</template>
