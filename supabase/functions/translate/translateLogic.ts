export function deeplApiBase(apiKey: string): string {
  return apiKey.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
}

export function normalizeTargetLang(lang: string): string {
  return lang.trim().toUpperCase();
}

// DeepL caps a request body at 128 KiB. Long articles are sent as several
// requests of at most this many UTF-8 bytes of text, leaving room for JSON
// escaping and the rest of the payload.
export const MAX_CHUNK_BYTES = 60_000;

export interface TextChunk {
  text: string;
  // What goes between this chunk and the next when reassembling: a blank
  // line between paragraphs, nothing inside a paragraph that had to be cut.
  glue: string;
}

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

function hardSplit(paragraph: string, maxBytes: number): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const char of paragraph) {
    if (utf8Length(current + char) > maxBytes) {
      pieces.push(current);
      current = "";
    }
    current += char;
  }
  if (current) pieces.push(current);
  return pieces;
}

// Splits at paragraph boundaries ("\n\n") so each request translates whole
// paragraphs; a single paragraph over the limit is cut by characters.
export function chunkText(text: string, maxBytes = MAX_CHUNK_BYTES): TextChunk[] {
  const chunks: TextChunk[] = [];
  let current: string | null = null;

  const flush = () => {
    if (current !== null) chunks.push({ text: current, glue: "\n\n" });
    current = null;
  };

  for (const paragraph of text.split("\n\n")) {
    if (utf8Length(paragraph) > maxBytes) {
      flush();
      const pieces = hardSplit(paragraph, maxBytes);
      pieces.forEach((piece, i) =>
        chunks.push({ text: piece, glue: i === pieces.length - 1 ? "\n\n" : "" }),
      );
      continue;
    }
    const candidate: string = current === null ? paragraph : `${current}\n\n${paragraph}`;
    if (utf8Length(candidate) > maxBytes) {
      flush();
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  flush();
  return chunks;
}

export function joinChunks(chunks: TextChunk[]): string {
  return chunks.map((chunk, i) => (i === chunks.length - 1 ? chunk.text : chunk.text + chunk.glue)).join("");
}
