<script setup lang="ts">
import { cn } from "../clsx";

export interface EmptyProps {
  testId?: string;
  class?: string;
}

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<EmptyProps>(), { testId: undefined, class: undefined });
</script>

<template>
  <div
    :data-testid="props.testId"
    :class="
      cn(
        'm-16 p-16 bg-[repeating-linear-gradient(-45deg,transparent_0_7px,var(--color-line)_7px_8px)]',
        props.class,
      )
    "
  >
    <p class="m-0 border border-line-strong bg-canvas px-16 py-20 label">
      <slot />
    </p>
  </div>
</template>
