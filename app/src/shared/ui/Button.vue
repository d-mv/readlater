<script setup lang="ts">
import { cn } from "../clsx";

export type ButtonVariant = "primary" | "secondary";
export type ButtonSize = "md" | "lg";

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: "button" | "submit";
  disabled?: boolean;
  testId?: string;
  class?: string;
}

export interface ButtonEmits {
  (e: "click", event: MouseEvent): void;
}

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<ButtonProps>(), {
  variant: "primary",
  size: "md",
  type: "button",
  disabled: false,
  testId: undefined,
  class: undefined,
});
const emit = defineEmits<ButtonEmits>();

// Braun actuators: mono, uppercase, letterspaced; a 2px tolerance, no shadow.
const base =
  "inline-flex items-center justify-center gap-6 rounded-sm px-14 font-mono text-xs uppercase tracking-meta leading-[normal] cursor-pointer border select-none disabled:opacity-50 disabled:cursor-default transition-colors duration-(--duration) ease-(--ease)";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-ink text-ink-inverse border-transparent hover:enabled:bg-transparent hover:enabled:text-ink hover:enabled:border-ink",
  secondary: "bg-transparent text-ink border-line-strong hover:enabled:bg-recessed",
};

const sizeClasses: Record<ButtonSize, string> = {
  md: "h-34",
  lg: "h-40 text-sm",
};
</script>

<template>
  <button
    :type="props.type"
    :disabled="props.disabled"
    :data-testid="props.testId"
    :class="cn(base, variantClasses[props.variant], sizeClasses[props.size], props.class)"
    @click="emit('click', $event)"
  >
    <slot />
  </button>
</template>
