export const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20MB
export const PDF_BUCKET = "bookmark-pdfs";

export function isPdfFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith(".pdf");
}

export function pdfObjectPath(userId: string): string {
  return `${userId}/${crypto.randomUUID()}.pdf`;
}

export function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^./\\]+$/, "");
  return base.trim() || filename;
}

export function decodeBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// pdf.js text extraction returns a flat run of text per page with no
// heading/bold markup, so "Markdown" here just means normalized paragraph
// text — collapse the runs of blank lines a page-by-page join tends to
// produce, without inventing structure the extraction doesn't have.
export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
