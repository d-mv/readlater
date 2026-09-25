import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import IconButton from "./IconButton.vue";

describe("IconButton", () => {
  test("uses its title as the accessible name and tooltip", () => {
    const button = mount(IconButton, { props: { title: "Settings" } }).get("button");
    expect(button.attributes("aria-label")).toBe("Settings");
    expect(button.attributes("title")).toBe("Settings");
    expect(button.attributes("type")).toBe("button");
  });

  test("exposes a toggle state via aria-pressed only when pressed is given", () => {
    expect(
      mount(IconButton, { props: { title: "t" } })
        .get("button")
        .attributes("aria-pressed"),
    ).toBeUndefined();
    expect(
      mount(IconButton, { props: { title: "t", pressed: true } })
        .get("button")
        .attributes("aria-pressed"),
    ).toBe("true");
  });

  test("emits click and maps testId", async () => {
    const wrapper = mount(IconButton, { props: { title: "t", testId: "back-btn" } });
    await wrapper.get('[data-testid="back-btn"]').trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
  });
});
