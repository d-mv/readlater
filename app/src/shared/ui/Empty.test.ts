import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import Empty from "./Empty.vue";

describe("Empty", () => {
  test("renders its slot and maps testId", () => {
    const wrapper = mount(Empty, {
      props: { testId: "empty-state" },
      slots: { default: "Nothing" },
    });
    expect(wrapper.text()).toBe("Nothing");
    expect(wrapper.attributes("data-testid")).toBe("empty-state");
  });
});
