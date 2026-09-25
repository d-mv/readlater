import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import Message from "./Message.vue";

describe("Message", () => {
  test("renders its slot in a paragraph", () => {
    const wrapper = mount(Message, { slots: { default: "Saved" } });
    expect(wrapper.element.tagName).toBe("P");
    expect(wrapper.text()).toBe("Saved");
  });

  test("error tones are announced as alerts", () => {
    expect(mount(Message, { props: { tone: "danger" } }).attributes("role")).toBe("alert");
    expect(mount(Message, { props: { tone: "accent" } }).attributes("role")).toBe("alert");
    expect(mount(Message).attributes("role")).toBeUndefined();
  });

  test("tones pick the colour", () => {
    expect(mount(Message, { props: { tone: "danger" } }).classes()).toContain("text-danger");
    expect(mount(Message, { props: { tone: "accent" } }).classes()).toContain("text-accent");
    expect(mount(Message).classes()).toContain("text-ink-muted");
  });
});
