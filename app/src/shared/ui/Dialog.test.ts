import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import Dialog from "./Dialog.vue";

describe("Dialog", () => {
  test("renders its content inside an open dialog over a scrim", () => {
    const wrapper = mount(Dialog, { slots: { default: "<p>Body</p>" } });
    expect(wrapper.get("dialog").attributes("open")).toBeDefined();
    expect(wrapper.get("dialog").text()).toBe("Body");
    expect(wrapper.find('[data-testid="backdrop"]').exists()).toBe(true);
  });

  test("clicking the scrim emits close; clicking inside the dialog doesn't", async () => {
    const wrapper = mount(Dialog, { slots: { default: "<button>Inside</button>" } });
    await wrapper.get("dialog button").trigger("click");
    expect(wrapper.emitted("close")).toBeUndefined();
    await wrapper.get('[data-testid="backdrop"]').trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  test("a sheet anchors to the bottom edge; the default is centered", () => {
    expect(mount(Dialog).get('[data-testid="backdrop"]').classes()).toContain("items-center");
    expect(
      mount(Dialog, { props: { placement: "sheet" } })
        .get('[data-testid="backdrop"]')
        .classes(),
    ).toContain("items-end");
  });

  test("maps testId onto the dialog element", () => {
    expect(
      mount(Dialog, { props: { testId: "share" } })
        .get("dialog")
        .attributes("data-testid"),
    ).toBe("share");
  });
});
