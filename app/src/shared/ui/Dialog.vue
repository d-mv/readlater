<script setup lang="ts">
import { cn } from "../clsx";

export type DialogPlacement = "center" | "sheet";

export interface DialogProps {
  // center: a card in the middle of the screen; sheet: anchored to the bottom.
  placement?: DialogPlacement;
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
  testId: undefined,
  class: undefined,
});
const emit = defineEmits<DialogEmits>();

const scrimClasses: Record<DialogPlacement, string> = {
  center: "items-center z-10",
  sheet: "items-end z-100",
};

const panelClasses: Record<DialogPlacement, string> = {
  center: "rounded-md p-24 w-320 max-w-[calc(100vw-32px)]",
  sheet: "static m-0 w-full max-w-480 rounded-t-md p-20 flex flex-col gap-16",
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
      :data-testid="props.testId"
      :class="cn('border-0 bg-raised text-ink', panelClasses[props.placement], props.class)"
    >
      <slot />
    </dialog>
  </div>
</template>
