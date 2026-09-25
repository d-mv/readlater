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
  <p
    :data-testid="props.testId"
    :class="cn('m-0 px-16 py-32 text-center text-sm text-ink-faint', props.class)"
  >
    <slot />
  </p>
</template>
