import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2.110.8";
import { extractText, getDocumentProxy } from "npm:unpdf@1.8.0";
import {
  isPdfFilename,
  MAX_PDF_BYTES,
  normalizeExtractedText,
  PDF_BUCKET,
  pdfObjectPath,
} from "./pdfImportLogic.ts";
import { decodeBase64, titleFromFilename } from "../_shared/file.ts";
import { readingTimeFromWordCount, truncateTitle, wordCount } from "../_shared/noteRow.ts";
import { jsonResponse, MAX_BODY_BYTES, readJsonBody, serverError } from "../_shared/http.ts";
import { bumpRateLimit } from "../_shared/rateLimit.ts";

// apikey and x-client-info are sent on every supabase-js request (including
// functions.invoke), not just authorization/content-type — omitting them
// fails the browser's CORS preflight before the request ever reaches here.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return jsonResponse(corsHeaders, body, status);
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // pdf.js may detach/transfer the buffer it's given; extract from a copy
  // so the original bytes are still intact for the upload that follows.
  const pdf = await getDocumentProxy(bytes.slice());
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

export async function handlePdfImport(
  supabase: SupabaseClient,
  input: { filename?: unknown; contentBase64?: unknown },
  extractPdf: (bytes: Uint8Array) => Promise<string> = extractPdfText,
): Promise<Response> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json("unauthorized", 401);

  const filename = typeof input.filename === "string" ? input.filename : "";
  const contentBase64 = typeof input.contentBase64 === "string" ? input.contentBase64 : "";
  if (!filename || !contentBase64) return json("file is empty", 400);

  if (!isPdfFilename(filename)) return json("unsupported file type — use .pdf", 400);

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(contentBase64);
  } catch {
    return json("file could not be decoded", 400);
  }

  if (bytes.byteLength > MAX_PDF_BYTES) return json("file exceeds the 20MB limit for PDFs", 400);

  const limit = await bumpRateLimit(supabase, "pdf-import");
  if (limit === "error") return json("internal error", 500);
  if (limit === "limited") return json("rate limit exceeded, try again later", 429);

  // Extract first, then upload, then insert: if the function dies during
  // extraction nothing has been written yet, so there's no Storage object
  // to orphan. A PDF with no extractable text layer (scanned images, etc.)
  // is an expected outcome, not a failure of the request — the reader falls
  // back to showing the original PDF in that case.
  let content = "";
  try {
    content = normalizeExtractedText(await extractPdf(bytes));
  } catch (err) {
    console.error("[pdf-import:extract]", err);
    content = "";
  }
  const parsed = content.length > 0;

  // Path is a fresh UUID per upload and never overwritten, so it's safe to
  // cache long-term rather than re-pulling the same bytes from Supabase on
  // every "view original" open.
  const path = pdfObjectPath(user.id);
  const { error: uploadError } = await supabase.storage
    .from(PDF_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", cacheControl: "31536000" });
  if (uploadError) return serverError(corsHeaders, "pdf-import:upload", uploadError);

  const words = parsed ? wordCount(content) : null;
  const title = truncateTitle(titleFromFilename(filename));

  const { data, error } = await supabase
    .from("bookmarks")
    .insert({
      url: null,
      title,
      content_md: parsed ? content : null,
      type: "pdf",
      status: "ready",
      pdf_path: path,
      pdf_parsed: parsed,
      word_count: words,
      reading_time: words === null ? null : readingTimeFromWordCount(words),
      user_id: user.id,
    })
    .select("*, tags(id, name, color)")
    .single();

  if (error) {
    // No row references the object: remove it now. If this fails too, the
    // storage-sweep function deletes it on its next run.
    const { error: removeError } = await supabase.storage.from(PDF_BUCKET).remove([path]);
    if (removeError) console.error("[pdf-import:cleanup]", path, removeError);
    return serverError(corsHeaders, "pdf-import:insert", error);
  }
  return json({ bookmark: data });
}

export async function handleRequest(
  req: Request,
  makeClient: (authorization: string) => SupabaseClient,
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json("not found", 404);

  const parsed = await readJsonBody(req, MAX_BODY_BYTES.pdfImport, corsHeaders);
  if (!parsed.ok) return parsed.response;

  return handlePdfImport(makeClient(req.headers.get("Authorization") ?? ""), parsed.body);
}

// import.meta.main is only true when this file is the process entry point
// (the deployed edge function), not when index.test.ts imports handlePdfImport
// — so the test run never tries to bind a port.
if (import.meta.main) {
  Deno.serve((req) =>
    handleRequest(req, (authorization) =>
      createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authorization } } },
      ))
  );
}
