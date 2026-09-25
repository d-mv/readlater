import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { useThemeStore } from "./theme";

/** A controllable prefers-color-scheme media query. */
function mockSystemTheme(dark: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const query = {
    matches: dark,
    addEventListener: (_type: string, fn: (event: { matches: boolean }) => void) =>
      listeners.add(fn),
    removeEventListener: (_type: string, fn: (event: { matches: boolean }) => void) =>
      listeners.delete(fn),
  };
  vi.stubGlobal("matchMedia", () => query);
  return {
    set(next: boolean) {
      query.matches = next;
      for (const fn of listeners) fn({ matches: next });
    },
  };
}

describe("useThemeStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    document.documentElement.dataset.theme = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("with nothing stored, follows the system theme", async () => {
    mockSystemTheme(true);
    const store = useThemeStore();
    await nextTick();

    expect(store.preference).toBe("system");
    expect(store.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  test("an explicit stored choice wins over the system theme", () => {
    mockSystemTheme(true);
    localStorage.setItem("theme", "light");
    const store = useThemeStore();

    expect(store.preference).toBe("light");
    expect(store.theme).toBe("light");
  });

  test("while on system, an OS theme change is applied immediately", async () => {
    const system = mockSystemTheme(false);
    const store = useThemeStore();

    system.set(true);
    await nextTick();

    expect(store.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  test("after an explicit choice, OS theme changes are ignored", async () => {
    const system = mockSystemTheme(false);
    const store = useThemeStore();
    store.setPreference("light");

    system.set(true);
    await nextTick();

    expect(store.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  test("setPreference persists the choice and applies it to <html>", async () => {
    mockSystemTheme(false);
    const store = useThemeStore();

    store.setPreference("dark");
    await nextTick();

    expect(localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    store.setPreference("system");
    await nextTick();

    expect(localStorage.getItem("theme")).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  test("cycle goes light → dark → system → light", () => {
    mockSystemTheme(false);
    localStorage.setItem("theme", "light");
    const store = useThemeStore();

    store.cycle();
    expect(store.preference).toBe("dark");
    store.cycle();
    expect(store.preference).toBe("system");
    store.cycle();
    expect(store.preference).toBe("light");
  });

  test("works without matchMedia (treats the system theme as light)", () => {
    vi.stubGlobal("matchMedia", undefined);
    const store = useThemeStore();
    expect(store.theme).toBe("light");
  });
});
