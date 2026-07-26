import { beforeEach, describe, expect, test } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import ThemeToggle from "./ThemeToggle.vue";

describe("ThemeToggle", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    document.documentElement.dataset.theme = "light";
  });

  test("renders a button labeled for the current theme", () => {
    const wrapper = mount(ThemeToggle);
    expect(wrapper.get("button").attributes("aria-label")).toBe("Switch to dark theme");
  });

  test("toggles the theme when clicked", async () => {
    const wrapper = mount(ThemeToggle);
    await wrapper.get("button").trigger("click");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(wrapper.get("button").attributes("aria-label")).toBe("Switch to light theme");
  });
});
