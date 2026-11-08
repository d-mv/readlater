<script setup lang="ts">
import { useTemplateRef } from "vue";
import { IconListCheck } from "@tabler/icons-vue";
import IconButton from "../../shared/ui/IconButton.vue";
import { cn } from "../../shared/clsx";

export interface SelectToggleProps {
  active: boolean;
  disabled?: boolean;
}

export interface SelectToggleEmits {
  (e: "change", active: boolean): void;
}

const props = withDefaults(defineProps<SelectToggleProps>(), { disabled: false });
const emit = defineEmits<SelectToggleEmits>();

const root = useTemplateRef<HTMLElement>("root");

// Focus comes back here when selection mode ends from the bar (Cancel, an
// action), whose buttons leave the page with it.
defineExpose({
  focus: () => root.value!.querySelector("button")!.focus(),
});
</script>

<template>
  <!-- Selection mode for bulk actions: pressed while selecting. -->
  <span ref="root" class="contents">
    <IconButton
      test-id="select-toggle"
      title="Select"
      :pressed="props.active"
      :disabled="props.disabled"
      :class="cn('-mt-8 size-28 shrink-0 hover:text-ink', props.active && 'bg-recessed text-ink')"
      @click="emit('change', !props.active)"
    >
      <IconListCheck :size="16" />
    </IconButton>
  </span>
</template>
