export function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface ListRowMetaInput {
  url: string;
  reading_time: number | null;
  read_at: string | null;
}

export function listRowMeta({ url, reading_time, read_at }: ListRowMetaInput): string {
  const parts = [domainFromUrl(url)];
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
