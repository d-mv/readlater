import { afterEach, describe, expect, test } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { EditorView } from "@codemirror/view";
import { loadMdEditor } from "./editor";

// One file per document state: CodeMirror mounts its <style> element once per
// document, so the nonce case can't share a jsdom with an editor mounted
// without one (editorNoNonce.test.ts covers that case).
describe("loadMdEditor with a CSP nonce", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("gives CodeMirror the page's nonce for the <style> element it injects", async () => {
    const meta = document.createElement("meta");
    meta.name = "csp-nonce";
    meta.content = "n0nce123";
    document.head.append(meta);

    const MdEditor = await loadMdEditor();
    const wrapper = mount(MdEditor, {
      props: { modelValue: "# hi", noPrettier: true, noHighlight: true },
      attachTo: document.body,
    });
    await flushPromises();

    const content = document.querySelector<HTMLElement>(".cm-editor")!;
    expect(EditorView.findFromDOM(content)?.state.facet(EditorView.cspNonce)).toBe("n0nce123");
    expect(document.head.querySelector('style[nonce="n0nce123"]')).not.toBeNull();
    wrapper.unmount();
  });
});
