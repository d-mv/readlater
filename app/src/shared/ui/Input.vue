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
  // Shown, selectable and copyable, but not editable; focusing selects it all.
  readonly?: boolean;
  autofocus?: boolean;
  autocomplete?: string;
  maxlength?: number;
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
  readonly: false,
  autofocus: false,
  autocomplete: undefined,
  maxlength: undefined,
  ariaLabel: undefined,
  testId: undefined,
  class: undefined,
});
const emit = defineEmits<InputEmits>();

const base =
  "w-full h-40 rounded-sm border border-line bg-canvas px-12 py-0 text-base leading-[normal] text-ink box-border hover:bg-recessed focus:border-ink focus:bg-canvas focus:outline-none transition-colors duration-(--duration)";

function onFocus(event: FocusEvent) {
  if (props.readonly) (event.target as HTMLInputElement).select();
}

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
    :maxlength="props.maxlength"
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
    :readonly="props.readonly"
    :autofocus="props.autofocus"
    :autocomplete="props.autocomplete"
    :maxlength="props.maxlength"
    :aria-label="props.ariaLabel"
    :data-testid="props.testId"
    :class="cn(base, props.class)"
    @focus="onFocus"
    @input="onInput"
    @paste="emit('paste', $event)"
  />
</template>
