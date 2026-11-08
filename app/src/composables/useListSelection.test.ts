import { describe, expect, test } from "vitest";
import { ref } from "vue";
import { useListSelection } from "./useListSelection";

const rows = (...ids: string[]) => ids.map((id) => ({ id }));

describe("useListSelection", () => {
  test("starts off, with nothing selected", () => {
    const selection = useListSelection(() => rows("a", "b"));

    expect(selection.active.value).toBe(false);
    expect(selection.selected.value).toEqual([]);
  });

  test("toggling a row turns selection on and picks it; toggling again drops it", () => {
    const selection = useListSelection(() => rows("a", "b"));

    selection.toggle("b");
    expect(selection.active.value).toBe(true);
    expect(selection.selected.value).toEqual(rows("b"));
    expect(selection.isSelected("b")).toBe(true);

    selection.toggle("b");
    expect(selection.selected.value).toEqual([]);
    expect(selection.isSelected("b")).toBe(false);
    // Still selecting: the bar stays until the user leaves.
    expect(selection.active.value).toBe(true);
  });

  test("select all picks every listed row, in list order", () => {
    const selection = useListSelection(() => rows("a", "b", "c"));
    selection.start();

    selection.selectAll();

    expect(selection.selected.value).toEqual(rows("a", "b", "c"));
    expect(selection.allSelected.value).toBe(true);
  });

  test("a row that leaves the list leaves the selection", () => {
    const listed = ref(rows("a", "b", "c"));
    const selection = useListSelection(() => listed.value);
    selection.toggle("a");
    selection.toggle("c");

    listed.value = rows("a", "b");

    expect(selection.selected.value).toEqual(rows("a"));
  });

  test("with nothing listed, nothing counts as all selected", () => {
    const selection = useListSelection(() => []);
    selection.start();

    expect(selection.allSelected.value).toBe(false);
  });

  test("stop leaves selection mode and forgets the picks", () => {
    const selection = useListSelection(() => rows("a", "b"));
    selection.toggle("a");

    selection.stop();

    expect(selection.active.value).toBe(false);
    selection.start();
    expect(selection.selected.value).toEqual([]);
  });
});
