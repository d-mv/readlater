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

  test("a tag colour is a square marker, never the fill", () => {
    const wrapper = mount(Pill, { props: { tone: "solid", color: "#ff0000" } });
    const marker = wrapper.get('[data-testid="tag-marker"]');
    expect(marker.attributes("style")).toContain("background-color: rgb(255, 0, 0)");
    expect(wrapper.attributes("style")).toBeUndefined();
  });

  test("no colour, no marker", () => {
    expect(mount(Pill).find('[data-testid="tag-marker"]').exists()).toBe(false);
  });

  test("tones map to distinct styles", () => {
    expect(mount(Pill, { props: { tone: "outline" } }).classes()).toContain("border-line");
    expect(mount(Pill, { props: { tone: "solid" } }).classes()).toContain("bg-ink");
    expect(mount(Pill, { props: { tone: "wash" } }).classes()).toContain("bg-accent-wash");
  });
});
