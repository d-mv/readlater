<script setup lang="ts">
import { cn } from "../clsx";

export type MessageTone = "muted" | "accent" | "danger";

export interface MessageProps {
  // accent/danger are error messages and are announced to assistive tech.
  tone?: MessageTone;
  testId?: string;
  class?: string;
}

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<MessageProps>(), {
  tone: "muted",
  testId: undefined,
  class: undefined,
});

const toneClasses: Record<MessageTone, string> = {
  muted: "text-ink-muted",
  accent: "text-accent",
  danger: "text-danger",
};
</script>

<template>
  <p
    :role="props.tone === 'muted' ? undefined : 'alert'"
    :data-testid="props.testId"
    :class="cn('m-0 text-sm', toneClasses[props.tone], props.class)"
  >
    <slot />
  </p>
</template>
