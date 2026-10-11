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

// Braun keeps colour off surfaces: a tag's colour is a 6px square marker
// (kairos area markers), the pill itself stays ink on neutral.
const toneClasses: Record<PillTone, string> = {
  outline: "border border-line bg-transparent text-ink-muted hover:border-line-strong",
  solid: "border border-ink bg-ink text-ink-inverse",
  wash: "border border-transparent bg-accent-wash text-accent-wash-ink",
};

const markerStyle = computed(() => (props.color ? { backgroundColor: props.color } : undefined));
const classes = computed(() =>
  cn(
    "inline-flex items-center gap-6 rounded-sm font-mono text-2xs uppercase tracking-meta",
    toneClasses[props.tone],
    props.class,
  ),
);
</script>

<template>
  <button
    v-if="props.as === 'button'"
    type="button"
    :aria-pressed="props.pressed"
    :data-testid="props.testId"
    :class="cn(classes, 'cursor-pointer')"
    @click="emit('click', $event)"
  >
    <span
      v-if="markerStyle"
      data-testid="tag-marker"
      aria-hidden="true"
      class="size-6 shrink-0"
      :style="markerStyle"
    />
    <slot />
  </button>
  <span v-else :data-testid="props.testId" :class="classes">
    <span
      v-if="markerStyle"
      data-testid="tag-marker"
      aria-hidden="true"
      class="size-6 shrink-0"
      :style="markerStyle"
    />
    <slot />
  </span>
</template>
