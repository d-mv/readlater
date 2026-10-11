// Request/response plumbing shared by every edge function: JSON responses
// that always carry the caller's CORS headers, a size-capped JSON body
// reader, and a generic 500 that logs the real cause server-side instead of
// echoing Postgres / Storage / DeepL error text back to the caller.

export type CorsHeaders = Record<string, string>;

// Request body caps, checked against Content-Length before anything is read
// and enforced again while streaming (a missing or lying Content-Length can't
// get past it).
export const MAX_BODY_BYTES = {
  capture: 1024 * 1024, // 1 MB
  snippet: 1024 * 1024, // 1 MB
  translate: 64 * 1024, // only bookmark_id + target_lang now; text is loaded server-side
  fileImport: 10 * 1024 * 1024, // 5 MB docx → ~6.7 MB base64, plus JSON
  pdfImport: 28 * 1024 * 1024, // 20 MB PDF → ~26.7 MB base64, plus JSON
} as const;

export function jsonResponse(cors: CorsHeaders, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

// Logs the underlying cause (a Postgres/Storage error object, an exception)
// and answers with a fixed message, so internals never reach the caller.
export function serverError(cors: CorsHeaders, context: string, cause: unknown): Response {
  console.error(`[${context}]`, cause);
  return jsonResponse(cors, "internal error", 500);
}

export type JsonBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: 400 | 413; response: Response };

async function readCapped(req: Request, maxBytes: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

// Parses a JSON object body of at most maxBytes. Oversize → 413, anything
// that isn't a JSON object (empty, malformed, array, primitive) → 400; both
// with CORS headers so the browser surfaces the status instead of a CORS
// failure.
export async function readJsonBody(
  req: Request,
  maxBytes: number,
  cors: CorsHeaders,
): Promise<JsonBodyResult> {
  const tooLarge = (): JsonBodyResult => ({
    ok: false,
    status: 413,
    response: jsonResponse(cors, "request body too large", 413),
  });
  const invalid = (): JsonBodyResult => ({
    ok: false,
    status: 400,
    response: jsonResponse(cors, "invalid JSON body", 400),
  });

  const declared = req.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0) return invalid();
    if (length > maxBytes) return tooLarge();
  }

  const bytes = await readCapped(req, maxBytes);
  if (bytes === null) return tooLarge();

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return invalid();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return invalid();
  return { ok: true, body: parsed as Record<string, unknown> };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ids go straight into a uuid-column filter; a malformed one would otherwise
// surface as a Postgres 22P02 (→ a generic 500) instead of a clear 400.
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
