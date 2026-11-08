import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import ShortcutsHelp from "./ShortcutsHelp.vue";

const shortcuts = [
  { keys: ["j", "↓"], label: "Next item" },
  { keys: ["?"], label: "Show shortcuts" },
];

describe("ShortcutsHelp", () => {
  test("is a dialog listing each shortcut's keys and what it does", () => {
    const wrapper = mount(ShortcutsHelp, { props: { shortcuts }, attachTo: document.body });
    const dialog = wrapper.get('[data-testid="shortcuts-help"]');

    expect(dialog.element.tagName).toBe("DIALOG");
    expect(dialog.attributes("aria-label")).toBe("Keyboard shortcuts");
    const rows = wrapper.findAll('[data-testid="shortcut"]');
    expect(rows.map((r) => r.findAll("kbd").map((k) => k.text()))).toEqual([["j", "↓"], ["?"]]);
    expect(rows.map((r) => r.get("dd").text())).toEqual(["Next item", "Show shortcuts"]);
    wrapper.unmount();
  });

  test("the close button and the dialog's own close both ask to close", async () => {
    const wrapper = mount(ShortcutsHelp, { props: { shortcuts }, attachTo: document.body });

    await wrapper.get('[data-testid="close-btn"]').trigger("click");
    wrapper.findComponent({ name: "Dialog" }).vm.$emit("close");

    expect(wrapper.emitted("close")).toHaveLength(2);
    wrapper.unmount();
  });
});
