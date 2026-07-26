import { beforeEach, describe, expect, test } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useFontSizeStore } from "./fontSize";

describe("useFontSizeStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    document.documentElement.style.removeProperty("--rl-article-font-size");
  });

  test("defaults to 16px and applies it as a CSS variable on <html>", () => {
    const store = useFontSizeStore();
    expect(store.fontSize).toBe(16);
    expect(document.documentElement.style.getPropertyValue("--rl-article-font-size")).toBe("16px");
  });

  test("restores a previously saved font size from localStorage", () => {
    localStorage.setItem("articleFontSize", "20");
    const store = useFontSizeStore();
    expect(store.fontSize).toBe(20);
    expect(document.documentElement.style.getPropertyValue("--rl-article-font-size")).toBe("20px");
  });

  test("increase grows the font size, updates the CSS variable, and persists it", () => {
    const store = useFontSizeStore();
    store.increase();
    expect(store.fontSize).toBe(18);
    expect(document.documentElement.style.getPropertyValue("--rl-article-font-size")).toBe("18px");
    expect(localStorage.getItem("articleFontSize")).toBe("18");
  });

  test("decrease shrinks the font size", () => {
    const store = useFontSizeStore();
    store.decrease();
    expect(store.fontSize).toBe(14);
  });

  test("does not increase past the maximum", () => {
    localStorage.setItem("articleFontSize", "24");
    const store = useFontSizeStore();
    store.increase();
    expect(store.fontSize).toBe(24);
    expect(store.canIncrease).toBe(false);
  });

  test("does not decrease past the minimum", () => {
    localStorage.setItem("articleFontSize", "14");
    const store = useFontSizeStore();
    store.decrease();
    expect(store.fontSize).toBe(14);
    expect(store.canDecrease).toBe(false);
  });

  test("ignores an invalid stored value and falls back to the default", () => {
    localStorage.setItem("articleFontSize", "not-a-number");
    const store = useFontSizeStore();
    expect(store.fontSize).toBe(16);
  });

  test("a font size change survives a simulated page reload (fresh pinia instance)", () => {
    const store = useFontSizeStore();
    store.increase();
    store.increase();
    expect(store.fontSize).toBe(20);

    // Simulate a full page reload: new Pinia instance, same localStorage.
    setActivePinia(createPinia());
    const reloaded = useFontSizeStore();
    expect(reloaded.fontSize).toBe(20);
    expect(document.documentElement.style.getPropertyValue("--rl-article-font-size")).toBe("20px");
  });
});
