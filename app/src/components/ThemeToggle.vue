<script setup lang="ts">
import { computed } from "vue";
import { IconMoon, IconSun } from "@tabler/icons-vue";
import { useThemeStore } from "../stores/theme";

const store = useThemeStore();

const isDark = computed(() => store.theme === "dark");
const label = computed(() => `Switch to ${isDark.value ? "light" : "dark"} theme`);
</script>

<template>
  <button class="icon-btn theme-toggle" type="button" :aria-label="label" @click="store.toggle()">
    <IconMoon v-if="!isDark" :size="18" />
    <IconSun v-else :size="18" />
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
