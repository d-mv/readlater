import { beforeEach, describe, expect, test } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useThemeStore } from "./theme";

describe("useThemeStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    document.documentElement.dataset.theme = "";
  });

  test("initializes from the theme already set on <html> by the anti-FOUC inline script", () => {
    document.documentElement.dataset.theme = "dark";
    const store = useThemeStore();
    expect(store.theme).toBe("dark");
  });

  test("falls back to light when nothing is set on <html>", () => {
    const store = useThemeStore();
    expect(store.theme).toBe("light");
  });

  test("toggle flips the theme, updates <html> dataset, and persists to localStorage", () => {
    document.documentElement.dataset.theme = "light";
    const store = useThemeStore();

    store.toggle();

    expect(store.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  test("toggling twice returns to the original theme", () => {
    const store = useThemeStore();
    store.toggle();
    store.toggle();
    expect(store.theme).toBe("light");
  });
});
