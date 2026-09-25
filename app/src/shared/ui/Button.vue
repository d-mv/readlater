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
  "inline-flex items-center justify-center gap-6 rounded-md px-14 text-sm cursor-pointer border-0 disabled:opacity-60 disabled:cursor-default";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink font-medium",
  secondary: "bg-transparent border-[0.5px] border-line text-ink",
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
