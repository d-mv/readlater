<script setup lang="ts" generic="T extends string">
import { cn } from "../clsx";

export interface TabOption<V extends string> {
  value: V;
  label: string;
  testId?: string;
}

export type TabsVariant = "underline" | "segmented";

export interface TabsProps<V extends string> {
  options: TabOption<V>[];
  modelValue: V;
  // underline: text tabs with an accent underline; segmented: a pill switch.
  variant?: TabsVariant;
  class?: string;
}

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<TabsProps<T>>(), {
  variant: "underline",
  class: undefined,
});
const emit = defineEmits<{ (e: "update:modelValue", value: T): void }>();

// underline: mono band labels over a hairline, the active one underscored in
// ink. segmented: the kairos selector — an ink-bordered band, the active
// segment ink-on.
const containerClasses: Record<TabsVariant, string> = {
  underline: "flex items-center gap-20",
  segmented: "flex rounded-sm border border-ink",
};

const optionClasses: Record<TabsVariant, { base: string; active: string }> = {
  underline: {
    base: "border-0 border-b-2 border-solid border-transparent bg-transparent px-0 pt-0 pb-8 font-mono text-xs uppercase tracking-label leading-[normal] text-ink-muted cursor-pointer hover:text-ink transition-colors duration-(--duration)",
    active: "text-ink border-b-ink",
  },
  segmented: {
    base: "flex-1 h-30 border-0 rounded-none bg-transparent font-mono text-xs uppercase tracking-label leading-[normal] text-ink cursor-pointer transition-colors duration-(--duration) not-first:border-l not-first:border-solid not-first:border-ink hover:bg-recessed",
    active: "bg-ink text-ink-inverse hover:bg-ink",
  },
};
</script>

<template>
  <div :class="cn(containerClasses[props.variant], props.class)">
    <button
      v-for="option in props.options"
      :key="option.value"
      type="button"
      :data-testid="option.testId"
      :aria-pressed="option.value === props.modelValue"
      :class="
        cn(
          optionClasses[props.variant].base,
          option.value === props.modelValue && optionClasses[props.variant].active,
        )
      "
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
    <slot />
  </div>
</template>
