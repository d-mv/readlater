<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  progress: number;
}>();

const widthPercent = computed(() => `${Math.min(100, Math.max(0, props.progress * 100))}%`);
</script>

<template>
  <div class="h-4 bg-line">
    <div
      data-testid="fill"
      class="h-full bg-accent transition-[width] duration-75"
      :style="{ width: widthPercent }"
    />
  </div>
</template>
