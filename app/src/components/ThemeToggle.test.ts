import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import ThemeToggle from "./ThemeToggle.vue";

describe("ThemeToggle", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("labels the current preference and the next one", () => {
    localStorage.setItem("theme", "light");
    const wrapper = mount(ThemeToggle);
    expect(wrapper.get("button").attributes("aria-label")).toBe("Theme: light. Switch to dark");
  });

  test("each click moves to the next preference: light → dark → system", async () => {
    localStorage.setItem("theme", "light");
    const wrapper = mount(ThemeToggle);
    const button = wrapper.get("button");

    await button.trigger("click");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(button.attributes("aria-label")).toBe("Theme: dark. Switch to system");

    await button.trigger("click");
    expect(localStorage.getItem("theme")).toBe("system");
    expect(button.attributes("aria-label")).toBe("Theme: system. Switch to light");
  });
});
