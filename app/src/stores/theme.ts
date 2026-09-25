import { defineStore } from "pinia";
import { computed, shallowRef, watch } from "vue";

export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

// Same key the pre-paint script in index.html reads, so the first paint and
// the store agree. "system" (or nothing stored) follows the OS setting.
const STORAGE_KEY = "theme";
const CYCLE: Record<ThemePreference, ThemePreference> = {
  light: "dark",
  dark: "system",
  system: "light",
};

function readPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export const useThemeStore = defineStore("theme", () => {
  const preference = shallowRef<ThemePreference>(readPreference());

  // matchMedia is missing in some non-browser environments; treat that as light.
  const media =
    typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const systemIsDark = shallowRef(media?.matches ?? false);
  media?.addEventListener("change", (event) => {
    systemIsDark.value = event.matches;
  });

  // The theme actually applied — always concrete, for consumers such as the
  // markdown editor that only understand light/dark.
  const theme = computed<Theme>(() =>
    preference.value === "system" ? (systemIsDark.value ? "dark" : "light") : preference.value,
  );

  watch(
    theme,
    (next) => {
      document.documentElement.dataset.theme = next;
    },
    { immediate: true },
  );

  function setPreference(next: ThemePreference) {
    preference.value = next;
    localStorage.setItem(STORAGE_KEY, next);
  }

  function cycle() {
    setPreference(CYCLE[preference.value]);
  }

  return { preference, theme, setPreference, cycle, next: computed(() => CYCLE[preference.value]) };
});
