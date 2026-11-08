import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import SelectToggle from "./SelectToggle.vue";

describe("SelectToggle", () => {
  test("is a toggle named Select, pressed while selecting", () => {
    const off = mount(SelectToggle, { props: { active: false } }).get(
      '[data-testid="select-toggle"]',
    );
    expect(off.attributes("aria-label")).toBe("Select");
    expect(off.attributes("aria-pressed")).toBe("false");

    const on = mount(SelectToggle, { props: { active: true } }).get(
      '[data-testid="select-toggle"]',
    );
    expect(on.attributes("aria-pressed")).toBe("true");
  });

  test("asks for the other state when clicked", async () => {
    const off = mount(SelectToggle, { props: { active: false } });
    await off.get("button").trigger("click");
    expect(off.emitted("change")).toEqual([[true]]);

    const on = mount(SelectToggle, { props: { active: true } });
    await on.get("button").trigger("click");
    expect(on.emitted("change")).toEqual([[false]]);
  });

  test("is off when there is nothing to select", () => {
    const button = mount(SelectToggle, { props: { active: false, disabled: true } }).get("button");
    expect(button.attributes("disabled")).toBeDefined();
  });

  test("can take focus back from the parent", () => {
    const wrapper = mount(SelectToggle, { props: { active: false }, attachTo: document.body });

    wrapper.vm.focus();

    expect(document.activeElement).toBe(wrapper.get("button").element);
    wrapper.unmount();
  });
});
