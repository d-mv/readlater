import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import SortToggle from "./SortToggle.vue";

describe("SortToggle", () => {
  test("is a toggle named Oldest first, off while newest first", () => {
    const button = mount(SortToggle, { props: { sort: "newest" } }).get(
      '[data-testid="sort-toggle"]',
    );
    expect(button.attributes("aria-label")).toBe("Oldest first");
    expect(button.attributes("aria-pressed")).toBe("false");
  });

  test("is pressed while oldest first", () => {
    const button = mount(SortToggle, { props: { sort: "oldest" } }).get(
      '[data-testid="sort-toggle"]',
    );
    expect(button.attributes("aria-pressed")).toBe("true");
  });

  test("asks for the other order when clicked", async () => {
    const newest = mount(SortToggle, { props: { sort: "newest" } });
    await newest.get("button").trigger("click");
    expect(newest.emitted("change")).toEqual([["oldest"]]);

    const oldest = mount(SortToggle, { props: { sort: "oldest" } });
    await oldest.get("button").trigger("click");
    expect(oldest.emitted("change")).toEqual([["newest"]]);
  });
});
