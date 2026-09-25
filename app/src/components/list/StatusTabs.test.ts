import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import StatusTabs from "./StatusTabs.vue";

describe("StatusTabs", () => {
  test("marks the active filter's tab", () => {
    const wrapper = mount(StatusTabs, { props: { activeFilter: "archived", unreadCount: 0 } });
    const tabs = wrapper.findAll('[data-testid="tab"]');
    expect(tabs[0]?.attributes("aria-pressed")).toBe("false");
    expect(tabs[1]?.attributes("aria-pressed")).toBe("true");
  });

  test("emits change with 'archived' when the Archived tab is clicked", async () => {
    const wrapper = mount(StatusTabs, { props: { activeFilter: "all", unreadCount: 0 } });
    await wrapper.findAll('[data-testid="tab"]')[1]?.trigger("click");
    expect(wrapper.emitted("change")).toEqual([["archived"]]);
  });

  test("shows the unread badge when there are unread items", () => {
    const wrapper = mount(StatusTabs, { props: { activeFilter: "all", unreadCount: 3 } });
    expect(wrapper.text()).toContain("3 unread");
  });

  test("hides the unread badge when count is zero", () => {
    const wrapper = mount(StatusTabs, { props: { activeFilter: "all", unreadCount: 0 } });
    expect(wrapper.text()).not.toContain("unread");
  });
});
