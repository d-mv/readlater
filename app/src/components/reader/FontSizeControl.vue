<script setup lang="ts">
import { useFontSizeStore } from "../../stores/fontSize";

const store = useFontSizeStore();
</script>

<template>
  <div class="font-size-control">
    <button
      class="icon-btn font-size-decrease"
      type="button"
      aria-label="Decrease font size"
      :disabled="!store.canDecrease"
      @click="store.decrease()"
    >
      A<span class="small">A</span>
    </button>
    <button
      class="icon-btn font-size-increase"
      type="button"
      aria-label="Increase font size"
      :disabled="!store.canIncrease"
      @click="store.increase()"
    >
      A<span class="big">A</span>
    </button>
  </div>
</template>

<style scoped>
.font-size-control {
  display: flex;
  align-items: center;
  gap: 12px;
}

.icon-btn {
  display: inline-flex;
  align-items: baseline;
  border: none;
  background: transparent;
  color: var(--rl-text-secondary);
  cursor: pointer;
  padding: 0;
  font-family: var(--rl-font-ui);
  font-size: 11px;
}

.icon-btn:disabled {
  color: var(--rl-text-muted);
  cursor: default;
  opacity: 0.5;
}

.font-size-decrease .small {
  font-size: 9px;
}

.font-size-increase .big {
  font-size: 15px;
}
</style>
