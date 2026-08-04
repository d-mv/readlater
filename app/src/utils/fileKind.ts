export type FileKind = "markdown" | "docx" | "pdf";

const MAX_BYTES: Record<FileKind, number> = {
  markdown: 500 * 1024,
  docx: 5 * 1024 * 1024,
  pdf: 20 * 1024 * 1024,
};

export function detectFileKind(filename: string): FileKind | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".pdf")) return "pdf";
  return null;
}

export function maxBytesForFileKind(kind: FileKind): number {
  return MAX_BYTES[kind];
}
