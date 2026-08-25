export function domainFromUrl(
  url: string | null,
  type?: "article" | "youtube" | "note" | "pdf",
): string {
  if (!url) return type === "pdf" ? "PDF" : "Note";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface ListRowMetaInput {
  url: string | null;
  type?: "article" | "youtube" | "note" | "pdf";
  reading_time: number | null;
  read_at: string | null;
}

export function listRowMeta({ url, type, reading_time, read_at }: ListRowMetaInput): string {
  const parts = [domainFromUrl(url, type)];
  if (reading_time !== null) parts.push(`${reading_time} min`);
  if (read_at !== null) parts.push("read");
  return parts.join(" · ");
}

interface ReaderBylineInput {
  author: string | null;
  reading_time: number | null;
}

export function readerByline({ author, reading_time }: ReaderBylineInput): string {
  const timePart = reading_time !== null ? `${reading_time} min read` : "";
  if (!author) return timePart;
  return timePart ? `By ${author} · ${timePart}` : `By ${author}`;
}
