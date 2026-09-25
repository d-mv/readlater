import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import Pill from "./Pill.vue";

describe("Pill", () => {
  test("is a span by default with its slot", () => {
    const wrapper = mount(Pill, { slots: { default: "reading" } });
    expect(wrapper.element.tagName).toBe("SPAN");
    expect(wrapper.text()).toBe("reading");
  });

  test("as a button it is a toggle: aria-pressed and click", async () => {
    const wrapper = mount(Pill, { props: { as: "button", pressed: false } });
    const button = wrapper.get("button");
    expect(button.attributes("type")).toBe("button");
    expect(button.attributes("aria-pressed")).toBe("false");
    await button.trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
  });

  test("a tag colour is exposed as --tag-color", () => {
    const wrapper = mount(Pill, { props: { tone: "solid", color: "#ff0000" } });
    expect(wrapper.attributes("style")).toContain("--tag-color: #ff0000");
  });

  test("tones map to distinct styles", () => {
    expect(mount(Pill, { props: { tone: "outline" } }).classes()).toContain("border-line");
    expect(mount(Pill, { props: { tone: "wash" } }).classes()).toContain("bg-accent-wash");
  });
});
