<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef } from "vue";
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
  // Clicking the scrim outside the dialog, or pressing Escape. The parent
  // owns visibility (it unmounts the Dialog), so neither closes it directly.
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

const placementClasses: Record<DialogPlacement, string> = {
  center: "m-auto w-320 max-w-[calc(100vw-32px)] rounded-sm border",
  // A modal dialog is position: fixed between top and bottom; auto top margin
  // drops it to the bottom edge.
  sheet: "mx-auto mt-auto mb-0 w-full max-w-480 rounded-none border-t",
};

const contentClasses: Record<DialogPlacement, string> = {
  center: "p-24",
  sheet: "p-20 flex flex-col gap-16",
};

const dialog = useTemplateRef<HTMLDialogElement>("dialog");
let previouslyFocused: Element | null = null;

onMounted(() => {
  previouslyFocused = document.activeElement;
  const el = dialog.value;
  if (!el) return;
  // showModal() makes the rest of the page inert (a native focus trap), moves
  // focus into the dialog, and turns Escape into a `cancel` event. jsdom has
  // no showModal, so tests fall back to a plain open dialog.
  if (typeof el.showModal === "function") el.showModal();
  else el.setAttribute("open", "");
});

onBeforeUnmount(() => {
  const el = dialog.value;
  if (el?.open && typeof el.close === "function") el.close();
  // Hand focus back to whatever opened the dialog (e.g. the Add button), so
  // keyboard and screen-reader users don't land at the top of the page.
  if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
    previouslyFocused.focus();
  }
});

function onCancel(event: Event) {
  // Let the parent unmount us instead of the browser closing the dialog on
  // its own, which would leave it mounted but hidden.
  event.preventDefault();
  emit("close");
}

function onClick(event: MouseEvent) {
  // The content wrapper fills the dialog, so a click whose target is the
  // dialog element itself landed on the ::backdrop scrim.
  if (event.target === event.currentTarget) emit("close");
}
</script>

<template>
  <dialog
    ref="dialog"
    :aria-label="props.ariaLabel"
    :data-testid="props.testId"
    :class="
      cn(
        'bg-raised p-0 text-ink border-line-strong backdrop:bg-scrim',
        placementClasses[props.placement],
        props.class,
      )
    "
    @cancel="onCancel"
    @click="onClick"
  >
    <div :class="contentClasses[props.placement]">
      <slot />
    </div>
  </dialog>
</template>
