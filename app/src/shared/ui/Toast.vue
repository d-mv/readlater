<script setup lang="ts">
import { computed } from "vue";
import { cn } from "../clsx";

export type ToastTone = "default" | "danger";

export interface ToastProps {
  open: boolean;
  // danger: a write that didn't happen.
  tone?: ToastTone;
  // A single action on the message (e.g. Undo); none when unset.
  actionLabel?: string;
  // The region gets testId; the card, message and button `${testId}-card`,
  // `-message`, `-action`.
  testId?: string;
  class?: string;
}

export interface ToastEmits {
  (e: "action"): void;
}

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<ToastProps>(), {
  tone: "default",
  actionLabel: undefined,
  testId: undefined,
  class: undefined,
});
const emit = defineEmits<ToastEmits>();

const toneClasses: Record<ToastTone, string> = {
  default: "bg-ink text-ink-inverse",
  danger: "bg-danger text-accent-ink",
};

const part = (name: string) => (props.testId ? `${props.testId}-${name}` : undefined);
const cardTestId = computed(() => part("card"));
const messageTestId = computed(() => part("message"));
const actionTestId = computed(() => part("action"));
</script>

<template>
  <!-- The live region stays in the DOM while closed: screen readers only
       announce changes to a region they already know about. It ignores the
       pointer so the page under it stays usable; only the card takes clicks.
       Sits above the home indicator (safe-area inset), and above a bar
       fixed to the bottom while one is up (--bottom-bar-height, main.css). -->
  <div
    role="status"
    aria-live="polite"
    aria-atomic="true"
    :data-testid="props.testId"
    class="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-16 pb-[calc(16px+var(--bottom-bar-height,0px)+env(safe-area-inset-bottom))]"
  >
    <div
      v-if="props.open"
      :data-testid="cardTestId"
      :class="
        cn(
          'pointer-events-auto flex w-full max-w-420 items-center gap-12 rounded-sm py-8 pr-8 pl-16 font-sans text-sm',
          toneClasses[props.tone],
          props.class,
        )
      "
    >
      <span :data-testid="messageTestId" class="min-w-0 flex-1 py-6"><slot /></span>
      <button
        v-if="props.actionLabel"
        type="button"
        :data-testid="actionTestId"
        class="h-32 shrink-0 cursor-pointer rounded-sm border border-current bg-transparent px-12 font-mono text-xs leading-[normal] tracking-meta text-current uppercase focus-visible:outline-current"
        @click="emit('action')"
      >
        {{ props.actionLabel }}
      </button>
    </div>
  </div>
</template>
