<script setup lang="ts">
import { computed } from "vue";
import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-vue";
import { useThemeStore } from "../stores/theme";

const store = useThemeStore();

const label = computed(() => `Theme: ${store.preference}. Switch to ${store.next}`);
</script>

<template>
  <button
    class="icon-btn theme-toggle"
    type="button"
    :aria-label="label"
    :title="label"
    @click="store.cycle()"
  >
    <IconSun v-if="store.preference === 'light'" :size="18" />
    <IconMoon v-else-if="store.preference === 'dark'" :size="18" />
    <IconDeviceDesktop v-else :size="18" />
  </button>
</template>

<style scoped>
.icon-btn {
  display: inline-flex;
  border: none;
  background: transparent;
  color: var(--rl-text-secondary);
  cursor: pointer;
  padding: 0;
}
</style>
