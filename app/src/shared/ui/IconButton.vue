<script setup lang="ts">
import { cn } from "../clsx";

export interface IconButtonProps {
  // Required: an icon-only button has no text, so this is its accessible name.
  title: string;
  // Set for toggle buttons; rendered as aria-pressed.
  pressed?: boolean;
  disabled?: boolean;
  testId?: string;
  class?: string;
}

export interface IconButtonEmits {
  (e: "click", event: MouseEvent): void;
}

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<IconButtonProps>(), {
  pressed: undefined,
  disabled: false,
  testId: undefined,
  class: undefined,
});
const emit = defineEmits<IconButtonEmits>();
</script>

<template>
  <button
    type="button"
    :aria-label="props.title"
    :title="props.title"
    :aria-pressed="props.pressed"
    :disabled="props.disabled"
    :data-testid="props.testId"
    :class="
      cn(
        'inline-flex items-center justify-center border-0 bg-transparent p-0 text-ink-muted cursor-pointer',
        props.class,
      )
    "
    @click="emit('click', $event)"
  >
    <slot />
  </button>
</template>
