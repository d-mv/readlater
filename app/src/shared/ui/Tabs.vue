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

const containerClasses: Record<TabsVariant, string> = {
  underline: "flex items-center gap-20",
  segmented: "flex rounded-md border-[0.5px] border-line p-2",
};

const optionClasses: Record<TabsVariant, { base: string; active: string }> = {
  underline: {
    base: "border-0 border-b-2 border-solid border-transparent bg-transparent px-0 pt-0 pb-8 text-ink-muted cursor-pointer [font-family:inherit] [font-size:inherit] [line-height:inherit]",
    active: "font-medium text-ink border-b-accent",
  },
  segmented: {
    base: "flex-1 h-28 border-0 rounded-sm bg-transparent text-sm text-ink-muted cursor-pointer",
    active: "bg-accent text-accent-ink font-medium",
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
