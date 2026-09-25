<script setup lang="ts">
import { computed } from "vue";
import { cn } from "../clsx";

export type PillTone = "outline" | "solid" | "wash";

export interface PillProps {
  // outline: bordered chip; solid: filled with the tag colour; wash: accent tint badge.
  tone?: PillTone;
  // A button pill is a toggle (tag filters); a span pill is a label.
  as?: "span" | "button";
  pressed?: boolean;
  // Tag colour, exposed as --tag-color for the solid tone.
  color?: string;
  testId?: string;
  class?: string;
}

export interface PillEmits {
  (e: "click", event: MouseEvent): void;
}

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<PillProps>(), {
  tone: "outline",
  as: "span",
  pressed: undefined,
  color: undefined,
  testId: undefined,
  class: undefined,
});
const emit = defineEmits<PillEmits>();

const toneClasses: Record<PillTone, string> = {
  outline: "border-[0.5px] border-line bg-transparent text-ink-muted",
  solid:
    "border-[0.5px] border-(--tag-color,var(--color-accent)) bg-(--tag-color,var(--color-accent)) text-accent-ink",
  wash: "bg-accent-wash text-accent-wash-ink font-medium",
};

const style = computed(() => (props.color ? { "--tag-color": props.color } : undefined));
const classes = computed(() =>
  cn("inline-flex items-center rounded-full text-xs", toneClasses[props.tone], props.class),
);
</script>

<template>
  <button
    v-if="props.as === 'button'"
    type="button"
    :aria-pressed="props.pressed"
    :data-testid="props.testId"
    :style="style"
    :class="cn(classes, 'cursor-pointer')"
    @click="emit('click', $event)"
  >
    <slot />
  </button>
  <span v-else :data-testid="props.testId" :style="style" :class="classes">
    <slot />
  </span>
</template>
