<script setup lang="ts">
import { useFontSizeStore } from "../../stores/fontSize";
import IconButton from "../../shared/ui/IconButton.vue";

const store = useFontSizeStore();
</script>

<template>
  <div class="flex items-center gap-12">
    <IconButton
      title="Decrease font size"
      test-id="font-size-decrease"
      class="items-baseline justify-start font-sans text-2xs disabled:cursor-default disabled:text-ink-faint disabled:opacity-50"
      :disabled="!store.canDecrease"
      @click="store.decrease()"
    >
      A<span class="text-[0.9rem]">A</span>
    </IconButton>
    <IconButton
      title="Increase font size"
      test-id="font-size-increase"
      class="items-baseline justify-start font-sans text-2xs disabled:cursor-default disabled:text-ink-faint disabled:opacity-50"
      :disabled="!store.canIncrease"
      @click="store.increase()"
    >
      A<span class="text-[1.5rem]">A</span>
    </IconButton>
  </div>
</template>
