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
  // line between paragraphs; inside a paragraph that had to be cut, the
  // separator at the cut ("\n" or a space), or nothing for a hard cut.
  glue: string;
}

const PARAGRAPH_SEPARATOR = "\n\n";
const PARAGRAPH_SEPARATOR_BYTES = 2;

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

// UTF-8 byte size of one code point.
function codePointBytes(cp: number): number {
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

const SENTENCE_END = new Set([".", "!", "?", "…", ";", ":"]);
const CJK_SENTENCE_END = new Set(["。", "！", "？"]);
const isSpace = (c: string) => /\s/.test(c);

// A cut inside a paragraph: the piece ends before `at`, and the `skip`
// characters starting at `at` (the separator) become that piece's glue.
interface Cut {
  at: number;
  skip: number;
}

// Picks where to end the piece that starts at `start`, given that the code
// points [start, limit) fit the byte budget. Prefers the last line break,
// then the last sentence end, then the last whitespace; a separator sitting
// exactly at `limit` still qualifies because it moves into the glue rather
// than being sent. Falls back to a hard cut at `limit`.
function findCut(chars: string[], start: number, limit: number): Cut {
  const last = Math.min(limit, chars.length - 1);
  for (let k = last; k > start; k--) {
    if (chars[k] === "\n") return { at: k, skip: 1 };
  }
  for (let k = last; k > start; k--) {
    if (isSpace(chars[k]) && SENTENCE_END.has(chars[k - 1])) return { at: k, skip: 1 };
    if (CJK_SENTENCE_END.has(chars[k - 1])) return { at: k, skip: 0 };
  }
  for (let k = last; k > start; k--) {
    if (isSpace(chars[k])) return { at: k, skip: 1 };
  }
  return { at: limit, skip: 0 };
}

// Cuts a paragraph over the byte limit into pieces of at most `maxBytes`,
// tracking byte length incrementally so the cost stays linear in the input.
// The separator at each cut is carried as the piece's glue (not its text, so
// a translator trimming whitespace can't drop it), and joining the pieces by
// their glue restores the paragraph exactly.
function splitParagraph(paragraph: string, maxBytes: number): TextChunk[] {
  const chars = Array.from(paragraph); // by code point: surrogate pairs stay whole
  const pieces: TextChunk[] = [];
  let start = 0;
  while (start < chars.length) {
    let limit = start;
    let bytes = 0;
    while (limit < chars.length) {
      const size = codePointBytes(chars[limit].codePointAt(0)!);
      if (bytes + size > maxBytes) break;
      bytes += size;
      limit++;
    }
    if (limit === chars.length) {
      pieces.push({ text: chars.slice(start).join(""), glue: "" });
      break;
    }
    // A single code point wider than maxBytes still has to go somewhere.
    if (limit === start) limit = start + 1;
    const cut = findCut(chars, start, limit);
    pieces.push({
      text: chars.slice(start, cut.at).join(""),
      glue: chars.slice(cut.at, cut.at + cut.skip).join(""),
    });
    start = cut.at + cut.skip;
  }
  return pieces;
}

// Splits at paragraph boundaries ("\n\n") so each request translates whole
// paragraphs; a single paragraph over the limit is cut at line breaks, then
// sentence ends, then whitespace, and only by characters as a last resort.
export function chunkText(text: string, maxBytes = MAX_CHUNK_BYTES): TextChunk[] {
  const chunks: TextChunk[] = [];
  let current: string[] = [];
  let currentBytes = 0;

  const flush = () => {
    if (current.length > 0) chunks.push({ text: current.join(PARAGRAPH_SEPARATOR), glue: PARAGRAPH_SEPARATOR });
    current = [];
    currentBytes = 0;
  };

  for (const paragraph of text.split(PARAGRAPH_SEPARATOR)) {
    const paragraphBytes = utf8Length(paragraph);
    if (paragraphBytes > maxBytes) {
      flush();
      const pieces = splitParagraph(paragraph, maxBytes);
      pieces[pieces.length - 1].glue = PARAGRAPH_SEPARATOR;
      chunks.push(...pieces);
      continue;
    }
    const candidateBytes =
      current.length === 0 ? paragraphBytes : currentBytes + PARAGRAPH_SEPARATOR_BYTES + paragraphBytes;
    if (candidateBytes > maxBytes) {
      flush();
      current = [paragraph];
      currentBytes = paragraphBytes;
    } else {
      current.push(paragraph);
      currentBytes = candidateBytes;
    }
  }
  flush();
  return chunks;
}

export function joinChunks(chunks: TextChunk[]): string {
  return chunks.map((chunk, i) => (i === chunks.length - 1 ? chunk.text : chunk.text + chunk.glue)).join("");
}
