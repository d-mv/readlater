<script setup lang="ts">
import { cn } from "../clsx";

export interface InputProps {
  modelValue: string;
  // Renders a multi-line <textarea> instead of an <input>.
  area?: boolean;
  id?: string;
  type?: "text" | "url" | "email" | "password" | "search";
  placeholder?: string;
  required?: boolean;
  autofocus?: boolean;
  autocomplete?: string;
  ariaLabel?: string;
  testId?: string;
  class?: string;
}

export interface InputEmits {
  (e: "update:modelValue", value: string): void;
  (e: "paste", event: ClipboardEvent): void;
}

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<InputProps>(), {
  area: false,
  id: undefined,
  type: "text",
  placeholder: undefined,
  required: false,
  autofocus: false,
  autocomplete: undefined,
  ariaLabel: undefined,
  testId: undefined,
  class: undefined,
});
const emit = defineEmits<InputEmits>();

const base =
  "w-full h-40 rounded-md border-[0.5px] border-line bg-canvas px-12 py-0 text-base text-ink box-border";

function onInput(event: Event) {
  emit("update:modelValue", (event.target as HTMLInputElement | HTMLTextAreaElement).value);
}
</script>

<template>
  <textarea
    v-if="props.area"
    :id="props.id"
    :value="props.modelValue"
    :placeholder="props.placeholder"
    :required="props.required"
    :autofocus="props.autofocus"
    :aria-label="props.ariaLabel"
    :data-testid="props.testId"
    :class="cn(base, 'h-120 py-8 resize-y [font-family:inherit]', props.class)"
    @input="onInput"
    @paste="emit('paste', $event)"
  ></textarea>
  <input
    v-else
    :id="props.id"
    :value="props.modelValue"
    :type="props.type"
    :placeholder="props.placeholder"
    :required="props.required"
    :autofocus="props.autofocus"
    :autocomplete="props.autocomplete"
    :aria-label="props.ariaLabel"
    :data-testid="props.testId"
    :class="cn(base, props.class)"
    @input="onInput"
    @paste="emit('paste', $event)"
  />
</template>
