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
//
// The same hook adds the app's CodeMirror theme. md-editor's own themes
// hard-code their text, caret, selection and syntax colours; this one uses
// the app's tokens (main.css), which already follow [data-theme=dark], so a
// single theme serves light and dark. Every rule carries an extra
// `.cm-editor` so it out-ranks md-editor's theme by specificity: CodeMirror
// mounts md-editor's (reconfigurable) theme after this one whatever the
// extension order.
const APP_THEME = {
  "&.cm-editor": { color: "var(--color-ink)", backgroundColor: "var(--color-recessed)" },
  "&.cm-editor .cm-content": { caretColor: "var(--color-ink)" },
  "&.cm-editor .cm-cursor, &.cm-editor .cm-dropCursor": { borderLeftColor: "var(--color-ink)" },
  "&.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, &.cm-editor .cm-selectionBackground, &.cm-editor .cm-content ::selection":
    { backgroundColor: "var(--color-line)" },
  // Markdown source stays monochrome, as the rest of the app: md-editor's
  // syntax colours go, its bold headings, italics and link underlines stay.
  "&.cm-editor .cm-line span": { color: "inherit" },
  "&.cm-editor .cm-line .cm-placeholder": { color: "var(--color-ink-faint)" },
  "&.cm-editor .cm-panels": { backgroundColor: "var(--color-canvas)", color: "var(--color-ink)" },
};

export async function loadMdEditor(): Promise<Component> {
  const [{ MdEditor, config }, { EditorView }] = await Promise.all([
    import("md-editor-v3"),
    import("@codemirror/view"),
    // md-editor's stylesheet with the app's overrides on top. Awaited, so
    // the editor never paints in md-editor's own colours first.
    import("./editor.css"),
  ]);
  const nonce = cspNonce();
  config({
    // md-editor 7 escapes raw HTML by default; converted Word/PDF uploads
    // carry some, and the reader renders it (ArticleContent.vue). The
    // preview still goes through the component's `sanitize` (DOMPurify).
    markdownItConfig: (md) => {
      md.set({ html: true });
    },
    codeMirrorExtensions: (extensions) => [
      ...extensions,
      { type: "appTheme", extension: EditorView.theme(APP_THEME) },
      ...(nonce ? [{ type: "cspNonce", extension: EditorView.cspNonce.of(nonce) }] : []),
    ],
  });
  return MdEditor;
}
