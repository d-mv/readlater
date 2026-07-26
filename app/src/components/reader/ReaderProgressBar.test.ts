import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import ReaderProgressBar from "./ReaderProgressBar.vue";

describe("ReaderProgressBar", () => {
  test("renders the fill at the given progress fraction as a percentage width", () => {
    const wrapper = mount(ReaderProgressBar, { props: { progress: 0.38 } });
    expect(wrapper.find(".fill").attributes("style")).toContain("width: 38%");
  });

  test("clamps display to 100% for progress values above 1", () => {
    const wrapper = mount(ReaderProgressBar, { props: { progress: 1.5 } });
    expect(wrapper.find(".fill").attributes("style")).toContain("width: 100%");
  });

  test("clamps display to 0% for negative progress values", () => {
    const wrapper = mount(ReaderProgressBar, { props: { progress: -0.2 } });
    expect(wrapper.find(".fill").attributes("style")).toContain("width: 0%");
  });
});
