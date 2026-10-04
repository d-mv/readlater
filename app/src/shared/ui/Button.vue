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

const base =
  "inline-flex items-center justify-center gap-6 rounded-none px-14 text-sm leading-[normal] cursor-pointer border select-none font-sans disabled:opacity-50 disabled:cursor-default disabled:active:translate-x-0 disabled:active:translate-y-0 active:translate-x-px active:translate-y-px transition-[background-color] duration-100";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink font-semibold border-line-strong hover:bg-accent-hover",
  secondary: "bg-raised text-ink border-line hover:bg-recessed",
};

const sizeClasses: Record<ButtonSize, string> = {
  md: "h-34",
  lg: "h-40 text-base",
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
