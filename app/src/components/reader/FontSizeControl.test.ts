import { beforeEach, describe, expect, test } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import FontSizeControl from "./FontSizeControl.vue";

describe("FontSizeControl", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    document.documentElement.style.removeProperty("--rl-article-font-size");
  });

  test("renders decrease and increase buttons", () => {
    const wrapper = mount(FontSizeControl);
    expect(wrapper.find(".font-size-decrease").exists()).toBe(true);
    expect(wrapper.find(".font-size-increase").exists()).toBe(true);
  });

  test("clicking increase grows the article font size", async () => {
    const wrapper = mount(FontSizeControl);
    await wrapper.find(".font-size-increase").trigger("click");
    expect(document.documentElement.style.getPropertyValue("--rl-article-font-size")).toBe("18px");
  });

  test("clicking decrease shrinks the article font size", async () => {
    const wrapper = mount(FontSizeControl);
    await wrapper.find(".font-size-decrease").trigger("click");
    expect(document.documentElement.style.getPropertyValue("--rl-article-font-size")).toBe("14px");
  });

  test("disables decrease at the minimum font size", async () => {
    localStorage.setItem("articleFontSize", "14");
    const wrapper = mount(FontSizeControl);
    expect(wrapper.find(".font-size-decrease").attributes("disabled")).toBeDefined();
  });

  test("disables increase at the maximum font size", async () => {
    localStorage.setItem("articleFontSize", "24");
    const wrapper = mount(FontSizeControl);
    expect(wrapper.find(".font-size-increase").attributes("disabled")).toBeDefined();
  });
});
