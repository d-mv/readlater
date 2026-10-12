// The per-response CSP nonce nginx writes into index.html (nginx.conf:
// sub_filter replaces the placeholder in <meta name="csp-nonce"> with the
// same $request_id its Content-Security-Policy header allows in
// style-src-elem). The editor's CodeMirror needs it for the <style> element
// it injects at runtime. Null where nothing substituted it — the dev server
// and tests, which send no CSP.
const PLACEHOLDER = "__CSP_NONCE__";

export function cspNonce(doc: Document = document): string | null {
  const value = doc.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;
  return value && value !== PLACEHOLDER ? value : null;
}
