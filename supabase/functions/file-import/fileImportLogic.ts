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
