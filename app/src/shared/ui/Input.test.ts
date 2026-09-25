import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import Input from "./Input.vue";

describe("Input", () => {
  test("is v-model compatible", async () => {
    const wrapper = mount(Input, { props: { modelValue: "a" } });
    const input = wrapper.get("input");
    expect((input.element as HTMLInputElement).value).toBe("a");
    await input.setValue("ab");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["ab"]);
  });

  test("renders a textarea when area is set", () => {
    const wrapper = mount(Input, { props: { modelValue: "", area: true } });
    expect(wrapper.find("textarea").exists()).toBe(true);
    expect(wrapper.find("input").exists()).toBe(false);
  });

  test("passes through the declared native attributes", () => {
    const input = mount(Input, {
      props: {
        modelValue: "",
        id: "email",
        type: "email",
        placeholder: "you@example.com",
        required: true,
        autocomplete: "email",
        ariaLabel: "Email",
        testId: "email-input",
        maxlength: 200,
      },
    }).get("input");
    expect(input.attributes()).toMatchObject({
      id: "email",
      type: "email",
      placeholder: "you@example.com",
      autocomplete: "email",
      "aria-label": "Email",
      "data-testid": "email-input",
      maxlength: "200",
    });
    expect(input.attributes("required")).toBeDefined();
  });

  test("re-emits paste with the original event", async () => {
    const wrapper = mount(Input, { props: { modelValue: "", area: true } });
    await wrapper.get("textarea").trigger("paste");
    expect(wrapper.emitted("paste")?.[0]?.[0]).toBeInstanceOf(Event);
  });

  test("merges class overrides onto the field", () => {
    const input = mount(Input, { props: { modelValue: "", class: "bg-raised h-34" } }).get("input");
    expect(input.classes()).toContain("bg-raised");
    expect(input.classes()).not.toContain("bg-canvas");
    expect(input.classes()).toContain("h-34");
    expect(input.classes()).not.toContain("h-40");
  });
});
