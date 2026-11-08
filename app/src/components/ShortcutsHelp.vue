<script setup lang="ts">
import { IconX } from "@tabler/icons-vue";
import Dialog from "../shared/ui/Dialog.vue";
import IconButton from "../shared/ui/IconButton.vue";

export interface ShortcutHelpItem {
  // Alternatives for the same action, e.g. ["j", "↓"].
  keys: string[];
  label: string;
}

export interface ShortcutsHelpProps {
  shortcuts: ShortcutHelpItem[];
}

export interface ShortcutsHelpEmits {
  (e: "close"): void;
}

const props = defineProps<ShortcutsHelpProps>();
const emit = defineEmits<ShortcutsHelpEmits>();
</script>

<template>
  <Dialog aria-label="Keyboard shortcuts" test-id="shortcuts-help" @close="emit('close')">
    <div class="mb-16 flex items-center justify-between">
      <h2 class="m-0 font-sans text-md font-medium tracking-tight text-ink">Keyboard shortcuts</h2>
      <IconButton title="Close" test-id="close-btn" @click="emit('close')">
        <IconX :size="18" />
      </IconButton>
    </div>
    <dl class="m-0 flex flex-col gap-10">
      <div
        v-for="shortcut in props.shortcuts"
        :key="shortcut.label"
        data-testid="shortcut"
        class="flex items-center justify-between gap-16"
      >
        <dt class="flex gap-4">
          <kbd
            v-for="key in shortcut.keys"
            :key="key"
            class="num inline-flex h-22 min-w-22 items-center justify-center rounded-sm border border-line-strong bg-recessed px-6 font-mono text-xs leading-[normal] text-ink"
            >{{ key }}</kbd
          >
        </dt>
        <dd class="m-0 text-right font-sans text-sm text-ink-muted">{{ shortcut.label }}</dd>
      </div>
    </dl>
  </Dialog>
</template>
