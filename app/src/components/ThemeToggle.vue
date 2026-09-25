<script setup lang="ts">
import { computed } from "vue";
import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-vue";
import { useThemeStore } from "../stores/theme";
import IconButton from "../shared/ui/IconButton.vue";

const store = useThemeStore();

const label = computed(() => `Theme: ${store.preference}. Switch to ${store.next}`);
</script>

<template>
  <IconButton :title="label" test-id="theme-toggle" @click="store.cycle()">
    <IconSun v-if="store.preference === 'light'" :size="18" />
    <IconMoon v-else-if="store.preference === 'dark'" :size="18" />
    <IconDeviceDesktop v-else :size="18" />
  </IconButton>
</template>
