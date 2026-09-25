<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  progress: number;
}>();

const widthPercent = computed(() => `${Math.min(100, Math.max(0, props.progress * 100))}%`);
</script>

<template>
  <div class="h-2 bg-line">
    <div data-testid="fill" class="h-full bg-accent" :style="{ width: widthPercent }" />
  </div>
</template>
