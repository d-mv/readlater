<script setup lang="ts">
import { cn } from "../clsx";

export type DialogPlacement = "center" | "sheet";

export interface DialogProps {
  // center: a card in the middle of the screen; sheet: anchored to the bottom.
  placement?: DialogPlacement;
  ariaLabel?: string;
  testId?: string;
  class?: string;
}

export interface DialogEmits {
  // Clicking the scrim outside the dialog.
  (e: "close"): void;
}

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<DialogProps>(), {
  placement: "center",
  ariaLabel: undefined,
  testId: undefined,
  class: undefined,
});
const emit = defineEmits<DialogEmits>();

const scrimClasses: Record<DialogPlacement, string> = {
  center: "items-center z-10",
  sheet: "items-end z-100",
};

const panelClasses: Record<DialogPlacement, string> = {
  center: "m-auto rounded-none p-24 w-320 max-w-[calc(100vw-32px)] border border-line-strong",
  sheet:
    "static m-0 w-full max-w-480 rounded-none p-20 flex flex-col gap-16 border-t border-line-strong",
};
</script>

<template>
  <div
    data-testid="backdrop"
    :class="cn('fixed inset-0 flex justify-center bg-black/40', scrimClasses[props.placement])"
    @click.self="emit('close')"
  >
    <dialog
      open
      :aria-label="props.ariaLabel"
      :data-testid="props.testId"
      :class="cn('bg-raised text-ink', panelClasses[props.placement], props.class)"
    >
      <slot />
    </dialog>
  </div>
</template>
