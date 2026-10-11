import { afterEach, describe, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";
import Dialog from "./Dialog.vue";

describe("Dialog", () => {
  test("renders its content inside an open dialog", () => {
    const wrapper = mount(Dialog, { slots: { default: "<p>Body</p>" } });
    expect(wrapper.get("dialog").attributes("open")).toBeDefined();
    expect(wrapper.get("dialog").text()).toBe("Body");
  });

  test("clicking the scrim (the dialog element itself) emits close; clicking content doesn't", async () => {
    const wrapper = mount(Dialog, { slots: { default: "<button>Inside</button>" } });
    await wrapper.get("dialog button").trigger("click");
    expect(wrapper.emitted("close")).toBeUndefined();
    await wrapper.get("dialog").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  test("a sheet anchors to the bottom edge; the default is centered", () => {
    expect(mount(Dialog).get("dialog").classes()).toContain("m-auto");
    expect(
      mount(Dialog, { props: { placement: "sheet" } })
        .get("dialog")
        .classes(),
    ).toContain("mt-auto");
  });

  test("maps testId onto the dialog element", () => {
    expect(
      mount(Dialog, { props: { testId: "share" } })
        .get("dialog")
        .attributes("data-testid"),
    ).toBe("share");
  });
});

describe("Dialog modality", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  test("opens modally where the browser supports it, and closes on unmount", () => {
    // jsdom has no showModal/close; stand in for a real browser.
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    const close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
    Object.assign(HTMLDialogElement.prototype, { showModal, close });
    try {
      const wrapper = mount(Dialog);
      expect(showModal).toHaveBeenCalledTimes(1);
      wrapper.unmount();
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      const proto = HTMLDialogElement.prototype as Partial<HTMLDialogElement>;
      delete proto.showModal;
      delete proto.close;
    }
  });

  test("Escape (the native cancel event) emits close and leaves closing to the parent", async () => {
    const wrapper = mount(Dialog);
    const cancel = new Event("cancel", { cancelable: true });
    wrapper.get("dialog").element.dispatchEvent(cancel);
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(cancel.defaultPrevented).toBe(true);
  });

  test("returns focus to the element that had it before opening", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const wrapper = mount(Dialog, {
      attachTo: document.body,
      slots: { default: "<button data-testid='inner'>Inside</button>" },
    });
    (wrapper.get('[data-testid="inner"]').element as HTMLButtonElement).focus();
    expect(document.activeElement).not.toBe(opener);

    wrapper.unmount();
    expect(document.activeElement).toBe(opener);
  });
});

describe("Dialog labelling", () => {
  test("ariaLabel names the dialog for assistive tech", () => {
    const dialog = mount(Dialog, { props: { ariaLabel: "Share bookmark" } }).get("dialog");
    expect(dialog.attributes("aria-label")).toBe("Share bookmark");
  });
});
