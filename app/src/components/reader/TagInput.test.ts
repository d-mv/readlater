import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import TagInput from "./TagInput.vue";

const tags = [{ id: "1", name: "vue", color: "#888888" }];

describe("TagInput", () => {
  test("renders existing tags", () => {
    const wrapper = mount(TagInput, { props: { tags } });
    expect(wrapper.text()).toContain("vue");
  });

  test("emits add with the trimmed draft text on enter and clears the input", async () => {
    const wrapper = mount(TagInput, { props: { tags: [] } });
    const input = wrapper.find(".tag-draft-input");
    await input.setValue("  reading  ");
    await input.trigger("keydown.enter");

    expect(wrapper.emitted("add")).toEqual([["reading"]]);
    expect((input.element as HTMLInputElement).value).toBe("");
  });

  test("does not emit add for an empty draft", async () => {
    const wrapper = mount(TagInput, { props: { tags: [] } });
    const input = wrapper.find(".tag-draft-input");
    await input.setValue("   ");
    await input.trigger("keydown.enter");

    expect(wrapper.emitted("add")).toBeUndefined();
  });

  test("emits remove with the tag id when its remove button is clicked", async () => {
    const wrapper = mount(TagInput, { props: { tags } });
    await wrapper.find(".remove-btn").trigger("click");
    expect(wrapper.emitted("remove")).toEqual([["1"]]);
  });
});
