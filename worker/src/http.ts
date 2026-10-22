import { ResponseTooLargeError, UnsupportedContentEncodingError } from "./errors";

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 (compatible; ReadLater/1.0)";

export const MAX_HTML_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** The media type of a response, lowercased and without parameters ("" if absent). */
export function mediaType(res: Response): string {
  return (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
}

/** Fetch options for a body read with readBodyCapped: Bun's fetch would
 * otherwise inflate a compressed body far ahead of the reader (a 2 MB gzip of
 * zeros grew the process by ~4 GB before the cap could stop it), so it hands
 * over the raw bytes and readBodyCapped decodes them under the cap. */
export const RAW_BODY_INIT = { decompress: false } as const;
export const ACCEPT_ENCODING = "gzip, deflate";

const DECODERS: Record<string, CompressionFormat> = {
  gzip: "gzip",
  "x-gzip": "gzip",
  deflate: "deflate",
};

function decodedBody(res: Response, body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const encoding = (res.headers.get("content-encoding") ?? "").trim().toLowerCase();
  if (encoding === "" || encoding === "identity") return body;
  const format = DECODERS[encoding];
  if (!format) throw new UnsupportedContentEncodingError(encoding);
  // DecompressionStream's lib typing is narrower than the Uint8Array chunks
  // fetch bodies actually carry.
  return body.pipeThrough(
    new DecompressionStream(format) as unknown as TransformStream<Uint8Array, Uint8Array>,
  );
}

/** Reads a response body, aborting as soon as it exceeds `maxBytes` instead of
 * buffering an arbitrarily large (or endless) body into memory. A gzip or
 * deflate body (fetched with RAW_BODY_INIT) is decoded here, and the cap
 * counts the decoded bytes. */
export async function readBodyCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new ResponseTooLargeError(maxBytes);
  }
  if (!res.body) return new Uint8Array();

  let body: ReadableStream<Uint8Array>;
  try {
    body = decodedBody(res, res.body);
  } catch (err) {
    await res.body.cancel().catch(() => {});
    throw err;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ResponseTooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
