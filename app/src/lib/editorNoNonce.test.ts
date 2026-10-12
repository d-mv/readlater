import { describe, expect, test } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { EditorView } from "@codemirror/view";
import { loadMdEditor } from "./editor";

describe("loadMdEditor without a CSP nonce (dev server, tests)", () => {
  test("leaves CodeMirror's style element without a nonce", async () => {
    const MdEditor = await loadMdEditor();
    const wrapper = mount(MdEditor, {
      props: { modelValue: "# hi", noPrettier: true, noHighlight: true },
      attachTo: document.body,
    });
    await flushPromises();

    const content = document.querySelector<HTMLElement>(".cm-editor")!;
    expect(EditorView.findFromDOM(content)?.state.facet(EditorView.cspNonce)).toBe("");
    expect(document.head.querySelector("style[nonce]")).toBeNull();
    wrapper.unmount();
  });
});
