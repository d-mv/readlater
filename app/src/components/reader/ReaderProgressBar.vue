<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  progress: number;
}>();

const widthPercent = computed(() => `${Math.min(100, Math.max(0, props.progress * 100))}%`);
</script>

<template>
  <div class="track">
    <div class="fill" :style="{ width: widthPercent }" />
  </div>
</template>

<style scoped>
.track {
  height: 2px;
  background: var(--rl-border);
}

.fill {
  height: 100%;
  background: var(--rl-accent);
}
</style>
