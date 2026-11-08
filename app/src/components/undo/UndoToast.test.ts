import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import UndoToast from "./UndoToast.vue";
import { useUndoStore } from "../../stores/undo";

enableAutoUnmount(afterEach);

function setVisibility(state: DocumentVisibilityState) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("UndoToast", () => {
  let undo: ReturnType<typeof useUndoStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    undo = useUndoStore();
    vi.spyOn(undo, "flush").mockResolvedValue();
    vi.spyOn(undo, "undo").mockResolvedValue();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const card = (wrapper: ReturnType<typeof mount>) =>
    wrapper.find('[data-testid="undo-toast-card"]');
  const action = (wrapper: ReturnType<typeof mount>) =>
    wrapper.find('[data-testid="undo-toast-action"]');

  test("closed while there's nothing to undo", () => {
    const wrapper = mount(UndoToast);

    expect(card(wrapper).exists()).toBe(false);
  });

  test("an archive offers Undo", async () => {
    const wrapper = mount(UndoToast);
    undo.notice = { kind: "archived", ids: ["1"] };
    await nextTick();

    expect(card(wrapper).text()).toContain("Archived");
    await action(wrapper).trigger("click");
    expect(undo.undo).toHaveBeenCalled();
  });

  test("a delete offers Undo", async () => {
    const wrapper = mount(UndoToast);
    undo.notice = { kind: "deleted", ids: ["1"] };
    await nextTick();

    expect(card(wrapper).text()).toContain("Deleted");
    expect(action(wrapper).text()).toBe("Undo");
  });

  test.each([
    ["archived", ["1", "2", "3"], "3 archived"],
    ["deleted", ["1", "2"], "2 deleted"],
    ["unarchived", ["1"], "Unarchived"],
    ["unarchived", ["1", "2"], "2 unarchived"],
  ] as const)("a bulk %s notice counts its rows (%j → %s)", async (kind, ids, text) => {
    const wrapper = mount(UndoToast);
    undo.notice = { kind, ids: [...ids] };
    await nextTick();

    expect(wrapper.find('[data-testid="undo-toast-message"]').text()).toBe(text);
    expect(action(wrapper).text()).toBe("Undo");
  });

  test("a failure says what went wrong, in the danger tone, with nothing to undo", async () => {
    const wrapper = mount(UndoToast);
    undo.notice = { kind: "failed", message: "Couldn't delete." };
    await nextTick();

    expect(card(wrapper).text()).toBe("Couldn't delete.");
    expect(card(wrapper).classes()).toContain("bg-danger");
    expect(action(wrapper).exists()).toBe(false);
  });

  test("leaving the page sends a waiting delete", () => {
    mount(UndoToast);

    window.dispatchEvent(new Event("pagehide"));

    expect(undo.flush).toHaveBeenCalledTimes(1);
  });

  test("the page going hidden sends it too; coming back doesn't", () => {
    mount(UndoToast);

    setVisibility("visible");
    expect(undo.flush).not.toHaveBeenCalled();
    setVisibility("hidden");
    expect(undo.flush).toHaveBeenCalledTimes(1);
  });

  test("once unmounted it stops listening", () => {
    const wrapper = mount(UndoToast);
    wrapper.unmount();

    window.dispatchEvent(new Event("pagehide"));
    setVisibility("hidden");

    expect(undo.flush).not.toHaveBeenCalled();
  });
});
