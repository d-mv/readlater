import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import TagFilterBar from "./TagFilterBar.vue";

const tags = [
  { id: "1", name: "vue", color: "#888888" },
  { id: "2", name: "reading", color: "#888888" },
];

describe("TagFilterBar", () => {
  test("renders nothing when there are no tags", () => {
    const wrapper = mount(TagFilterBar, { props: { tags: [], activeTagIds: [] } });
    expect(wrapper.find(".tag-filter-bar").exists()).toBe(false);
  });

  test("renders a chip per tag", () => {
    const wrapper = mount(TagFilterBar, { props: { tags, activeTagIds: [] } });
    const chips = wrapper.findAll(".tag-chip");
    expect(chips).toHaveLength(2);
    expect(chips[0]?.text()).toBe("vue");
  });

  test("marks active tags", () => {
    const wrapper = mount(TagFilterBar, { props: { tags, activeTagIds: ["2"] } });
    const chips = wrapper.findAll(".tag-chip");
    expect(chips[0]?.classes()).not.toContain("tag-chip-active");
    expect(chips[1]?.classes()).toContain("tag-chip-active");
  });

  test("emits toggle with the tag id when a chip is clicked", async () => {
    const wrapper = mount(TagFilterBar, { props: { tags, activeTagIds: [] } });
    await wrapper.findAll(".tag-chip")[0]?.trigger("click");
    expect(wrapper.emitted("toggle")).toEqual([["1"]]);
  });
});
