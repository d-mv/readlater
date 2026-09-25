import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import Tabs from "./Tabs.vue";

const options = [
  { value: "all", label: "All", testId: "tab" },
  { value: "archived", label: "Archived", testId: "tab" },
];

describe("Tabs", () => {
  test("renders one pressed-state button per option", () => {
    const buttons = mount(Tabs, { props: { options, modelValue: "archived" } }).findAll("button");
    expect(buttons.map((b) => b.text())).toEqual(["All", "Archived"]);
    expect(buttons.map((b) => b.attributes("aria-pressed"))).toEqual(["false", "true"]);
    expect(buttons[0]?.attributes("data-testid")).toBe("tab");
  });

  test("selecting an option emits its value", async () => {
    const wrapper = mount(Tabs, { props: { options, modelValue: "all" } });
    await wrapper.findAll("button")[1]?.trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["archived"]);
  });

  test("underline and segmented variants style the active option differently", () => {
    const underline = mount(Tabs, { props: { options, modelValue: "all" } }).findAll("button");
    expect(underline[0]?.classes()).toContain("border-b-accent");
    const segmented = mount(Tabs, {
      props: { options, modelValue: "all", variant: "segmented" },
    }).findAll("button");
    expect(segmented[0]?.classes()).toContain("bg-accent");
    expect(segmented[1]?.classes()).not.toContain("bg-accent");
  });
});
