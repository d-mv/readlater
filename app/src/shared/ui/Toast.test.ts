import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import Toast from "./Toast.vue";

describe("Toast", () => {
  test("the live region is always there, so a message landing in it is announced", () => {
    const wrapper = mount(Toast, { props: { open: false, testId: "toast" } });

    const region = wrapper.get('[data-testid="toast"]');
    expect(region.attributes("role")).toBe("status");
    expect(region.attributes("aria-live")).toBe("polite");
    expect(region.text()).toBe("");
  });

  test("open, it shows its message and an action button", async () => {
    const wrapper = mount(Toast, {
      props: { open: true, actionLabel: "Undo", testId: "toast" },
      slots: { default: "Deleted" },
    });

    expect(wrapper.get('[data-testid="toast-message"]').text()).toBe("Deleted");
    const action = wrapper.get('[data-testid="toast-action"]');
    expect(action.element.tagName).toBe("BUTTON");
    expect(action.attributes("type")).toBe("button");
    expect(action.text()).toBe("Undo");
    await action.trigger("click");
    expect(wrapper.emitted("action")).toHaveLength(1);
  });

  test("without an action label there is no button", () => {
    const wrapper = mount(Toast, { props: { open: true }, slots: { default: "Saved" } });

    expect(wrapper.find("button").exists()).toBe(false);
  });

  test("tones pick the colours; class lands on the card", () => {
    const plain = mount(Toast, { props: { open: true, class: "extra", testId: "t" } });
    const card = plain.get('[data-testid="t-card"]');
    expect(card.classes()).toEqual(expect.arrayContaining(["bg-ink", "text-ink-inverse", "extra"]));

    const danger = mount(Toast, { props: { open: true, tone: "danger", testId: "t" } });
    expect(danger.get('[data-testid="t-card"]').classes()).toContain("bg-danger");
  });

  test("attributes don't fall through", () => {
    const wrapper = mount(Toast, { props: { open: true }, attrs: { id: "x" } });

    expect(wrapper.find("#x").exists()).toBe(false);
  });
});
