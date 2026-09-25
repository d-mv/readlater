import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import Button from "./Button.vue";

describe("Button", () => {
  test("renders a type=button with its slot and emits click", async () => {
    const wrapper = mount(Button, { slots: { default: "Save" } });
    const button = wrapper.get("button");
    expect(button.attributes("type")).toBe("button");
    expect(button.text()).toBe("Save");
    await button.trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
  });

  test("primary is the default variant; secondary gets the outlined style", () => {
    expect(mount(Button).get("button").classes()).toContain("bg-accent");
    const secondary = mount(Button, { props: { variant: "secondary" } }).get("button");
    expect(secondary.classes()).toContain("border-line");
    expect(secondary.classes()).not.toContain("bg-accent");
  });

  test("lg is 40px tall; md is 34px", () => {
    expect(mount(Button).get("button").classes()).toContain("h-34");
    expect(
      mount(Button, { props: { size: "lg" } })
        .get("button")
        .classes(),
    ).toContain("h-40");
  });

  test("a disabled button doesn't emit click", async () => {
    const wrapper = mount(Button, { props: { disabled: true } });
    await wrapper.get("button").trigger("click");
    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
    expect(wrapper.emitted("click")).toBeUndefined();
  });

  test("maps testId and merges class, without falling through other attributes", () => {
    const wrapper = mount(Button, {
      props: { testId: "save-btn", class: "w-full h-40" },
      attrs: { "data-foo": "x" },
    });
    const button = wrapper.get("button");
    expect(button.attributes("data-testid")).toBe("save-btn");
    expect(button.classes()).toContain("w-full");
    expect(button.classes()).toContain("h-40");
    expect(button.classes()).not.toContain("h-34");
    expect(button.attributes("data-foo")).toBeUndefined();
  });

  test("submit buttons pass their type through", () => {
    expect(
      mount(Button, { props: { type: "submit" } })
        .get("button")
        .attributes("type"),
    ).toBe("submit");
  });
});
