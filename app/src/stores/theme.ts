import { defineStore } from "pinia";
import { shallowRef } from "vue";

export type Theme = "light" | "dark";

export const useThemeStore = defineStore("theme", () => {
  const initial = (document.documentElement.dataset.theme || "light") as Theme;
  const theme = shallowRef<Theme>(initial);

  function apply(next: Theme) {
    theme.value = next;
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
  }

  function toggle() {
    apply(theme.value === "dark" ? "light" : "dark");
  }

  return { theme, toggle };
});
