import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import SelectionBar, { type SelectionBarProps } from "./SelectionBar.vue";

const defaults: SelectionBarProps = {
  count: 3,
  archivedTab: false,
  offline: false,
  busy: false,
  markReadCount: 3,
  saveOfflineCount: 3,
  allSelected: false,
};

function bar(props: Partial<SelectionBarProps> = {}) {
  return mount(SelectionBar, { props: { ...defaults, ...props } });
}

const button = (wrapper: ReturnType<typeof bar>, testId: string) =>
  wrapper.get(`[data-testid="${testId}"]`);
const disabled = (wrapper: ReturnType<typeof bar>, testId: string) =>
  button(wrapper, testId).attributes("disabled") !== undefined;

describe("SelectionBar", () => {
  test("a labelled region that says how many rows are selected, politely announced", () => {
    const wrapper = bar();
    const region = wrapper.get('[data-testid="selection-bar"]');

    expect(region.element.tagName).toBe("SECTION");
    expect(region.attributes("aria-label")).toBe("Selection");
    expect(region.attributes("data-bottom-bar")).toBeDefined();
    const count = wrapper.get('[data-testid="selection-count"]');
    expect(count.text()).toBe("3 selected");
    expect(count.attributes("aria-live")).toBe("polite");
  });

  test.each([
    ["bulk-archive", "archive"],
    ["bulk-delete", "delete"],
    ["bulk-mark-read", "markRead"],
    ["bulk-save-offline", "saveOffline"],
    ["select-all", "selectAll"],
    ["selection-cancel", "cancel"],
  ])("%s emits %s", async (testId, event) => {
    const wrapper = bar();

    await button(wrapper, testId).trigger("click");

    expect(wrapper.emitted(event)).toHaveLength(1);
  });

  test("the Archived tab offers Unarchive instead of Archive", async () => {
    const wrapper = bar({ archivedTab: true });

    expect(wrapper.find('[data-testid="bulk-archive"]').exists()).toBe(false);
    await button(wrapper, "bulk-unarchive").trigger("click");
    expect(wrapper.emitted("unarchive")).toHaveLength(1);
  });

  test("with nothing selected, no action can run", () => {
    const wrapper = bar({ count: 0, markReadCount: 0, saveOfflineCount: 0 });

    for (const id of ["bulk-archive", "bulk-delete", "bulk-mark-read", "bulk-save-offline"]) {
      expect(disabled(wrapper, id)).toBe(true);
    }
    expect(disabled(wrapper, "select-all")).toBe(false);
  });

  test("an action with no eligible row is off", () => {
    const wrapper = bar({ markReadCount: 0, saveOfflineCount: 0 });

    expect(disabled(wrapper, "bulk-mark-read")).toBe(true);
    expect(disabled(wrapper, "bulk-save-offline")).toBe(true);
    expect(disabled(wrapper, "bulk-archive")).toBe(false);
  });

  test("busy while a write is in flight: nothing can run twice", () => {
    const wrapper = bar({ busy: true });

    for (const id of ["bulk-archive", "bulk-delete", "bulk-mark-read", "bulk-save-offline"]) {
      expect(disabled(wrapper, id)).toBe(true);
    }
  });

  test("offline, every action is off and the bar says why", () => {
    const wrapper = bar({ offline: true });
    const reason = wrapper.get('[data-testid="selection-offline"]');

    expect(reason.text()).toContain("Offline");
    for (const id of ["bulk-archive", "bulk-delete", "bulk-mark-read", "bulk-save-offline"]) {
      expect(disabled(wrapper, id)).toBe(true);
      expect(button(wrapper, id).attributes("aria-describedby")).toBe(reason.attributes("id"));
    }
    expect(disabled(wrapper, "selection-cancel")).toBe(false);
  });

  test("online, there's no reason to give", () => {
    const wrapper = bar();

    expect(wrapper.find('[data-testid="selection-offline"]').exists()).toBe(false);
    expect(button(wrapper, "bulk-archive").attributes("aria-describedby")).toBeUndefined();
  });

  test("select all is off once everything listed is selected", () => {
    expect(disabled(bar({ allSelected: true }), "select-all")).toBe(true);
  });
});
