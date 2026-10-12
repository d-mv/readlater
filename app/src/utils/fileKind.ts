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

const KIB = 1024;
const MIB = 1024 * KIB;

// A size limit as UI copy ("500KB", "5MB", "1.5MB"), binary units to match
// how the limits are defined. Labels come from here so they can't drift from
// the limits themselves.
export function formatSizeLimit(bytes: number): string {
  if (bytes >= MIB) return `${Number((bytes / MIB).toFixed(1))}MB`;
  return `${Number((bytes / KIB).toFixed(1))}KB`;
}

export function sizeLimitLabelForFileKind(kind: FileKind): string {
  return formatSizeLimit(MAX_BYTES[kind]);
}
