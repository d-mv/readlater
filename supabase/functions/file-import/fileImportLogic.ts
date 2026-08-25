export const MAX_MARKDOWN_BYTES = 500 * 1024; // 500KB
export const MAX_DOCX_BYTES = 5 * 1024 * 1024; // 5MB

export type FileKind = "markdown" | "docx";

export function detectKind(filename: string): FileKind | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".docx")) return "docx";
  return null;
}

export function maxBytesFor(kind: FileKind): number {
  return kind === "markdown" ? MAX_MARKDOWN_BYTES : MAX_DOCX_BYTES;
}

export function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^./\\]+$/, "");
  return base.trim() || filename;
}

export function decodeBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// Duplicated from ../snippet/snippetLogic.ts rather than imported — each
// edge function is deployed independently, so cross-function relative
// imports aren't reliable across environments.
export function truncateTitle(text: string, max = 100): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return cut.trim() + "…";
}

const WORDS_PER_MINUTE = 200;

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

export function readingTimeFromWordCount(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}
