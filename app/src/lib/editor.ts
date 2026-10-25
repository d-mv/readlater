import type { Component } from "vue";
import { cspNonce } from "./cspNonce";

// Loads md-editor-v3 (and the CodeMirror it runs on) on first use, as the
// async component behind the reader's Edit mode — it stays out of the base
// bundle and its chunks out of the precache (vite.config.ts).
//
// CodeMirror injects its theme as a <style> element at runtime, which the
// CSP only admits with the response's nonce (nginx.conf, style-src-elem).
// EditorView.cspNonce puts that nonce on the element; md-editor's
// codeMirrorExtensions hook is the only way into the EditorView it creates.
export async function loadMdEditor(): Promise<Component> {
  const [{ MdEditor, config }, { EditorView }] = await Promise.all([
    import("md-editor-v3"),
    import("@codemirror/view"),
  ]);
  void import("md-editor-v3/lib/style.css");
  const nonce = cspNonce();
  config({
    // md-editor 7 escapes raw HTML by default; converted Word/PDF uploads
    // carry some, and the reader renders it (ArticleContent.vue). The
    // preview still goes through the component's `sanitize` (DOMPurify).
    markdownItConfig: (md) => {
      md.set({ html: true });
    },
    ...(nonce && {
      codeMirrorExtensions: (extensions) => [
        ...extensions,
        { type: "cspNonce", extension: EditorView.cspNonce.of(nonce) },
      ],
    }),
  });
  return MdEditor;
}
