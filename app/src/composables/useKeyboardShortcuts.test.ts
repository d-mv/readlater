import { defineComponent, h } from "vue";
import { afterEach, describe, expect, test, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { useKeyboardShortcuts, type ShortcutMap } from "./useKeyboardShortcuts";

enableAutoUnmount(afterEach);

function mountWith(shortcuts: ShortcutMap, active?: () => boolean) {
  return mount(
    defineComponent({
      setup() {
        useKeyboardShortcuts(shortcuts, active);
        return () =>
          h("div", [
            h("input", { "data-testid": "field" }),
            h("textarea", { "data-testid": "area" }),
            h("select", { "data-testid": "select" }),
            h("div", { contenteditable: "true", "data-testid": "editable" }, [
              h("span", { "data-testid": "inside-editable" }),
            ]),
            h("div", { contenteditable: "false", "data-testid": "not-editable" }),
            h("div", { role: "menu" }, [h("button", { "data-testid": "menu-item" })]),
            h("button", { "data-testid": "plain" }),
          ]);
      },
    }),
    { attachTo: document.body },
  );
}

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe("useKeyboardShortcuts", () => {
  test("runs the mapped key's handler and keeps the key from doing anything else", () => {
    const j = vi.fn();
    mountWith({ j });

    const event = press(document.body, "j");

    expect(j).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  test("leaves unmapped keys alone", () => {
    const j = vi.fn();
    mountWith({ j });

    const event = press(document.body, "x");

    expect(j).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  test("allows Shift (? is Shift+/) but not Ctrl, Meta or Alt", () => {
    const help = vi.fn();
    const j = vi.fn();
    mountWith({ "?": help, j });

    press(document.body, "?", { shiftKey: true });
    press(document.body, "j", { ctrlKey: true });
    press(document.body, "j", { metaKey: true });
    press(document.body, "j", { altKey: true });

    expect(help).toHaveBeenCalledTimes(1);
    expect(j).not.toHaveBeenCalled();
  });

  test("never fires while typing in a field, a textarea, a select or the editor", () => {
    const j = vi.fn();
    const wrapper = mountWith({ j });

    for (const id of ["field", "area", "select", "editable", "inside-editable", "menu-item"]) {
      press(wrapper.get(`[data-testid="${id}"]`).element, "j");
    }
    expect(j).not.toHaveBeenCalled();

    press(wrapper.get('[data-testid="not-editable"]').element, "j");
    press(wrapper.get('[data-testid="plain"]').element, "j");
    expect(j).toHaveBeenCalledTimes(2);
  });

  test("stays quiet while a dialog is open", () => {
    const j = vi.fn();
    mountWith({ j });
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);

    press(document.body, "j");
    dialog.remove();
    press(document.body, "j");

    expect(j).toHaveBeenCalledTimes(1);
  });

  test("ignores a key already handled, or mid-composition", () => {
    const j = vi.fn();
    mountWith({ j });
    document.body.addEventListener("keydown", (e) => e.preventDefault(), { once: true });

    press(document.body, "j");
    press(document.body, "j", { isComposing: true });

    expect(j).not.toHaveBeenCalled();
  });

  test("is switched off while `active` says so", () => {
    let on = false;
    const j = vi.fn();
    mountWith({ j }, () => on);

    press(document.body, "j");
    on = true;
    press(document.body, "j");

    expect(j).toHaveBeenCalledTimes(1);
  });

  test("stops listening once unmounted", () => {
    const j = vi.fn();
    mountWith({ j }).unmount();

    press(document.body, "j");

    expect(j).not.toHaveBeenCalled();
  });
});
