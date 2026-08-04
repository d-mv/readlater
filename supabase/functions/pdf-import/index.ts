import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "npm:unpdf";
import {
  decodeBase64,
  isPdfFilename,
  MAX_PDF_BYTES,
  normalizeExtractedText,
  PDF_BUCKET,
  pdfObjectPath,
  readingTimeFromWordCount,
  titleFromFilename,
  truncateTitle,
  wordCount,
} from "./pdfImportLogic.ts";

// apikey and x-client-info are sent on every supabase-js request (including
// functions.invoke), not just authorization/content-type — omitting them
// fails the browser's CORS preflight before the request ever reaches here.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
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

  const path = pdfObjectPath(user.id);
  const { error: uploadError } = await supabase.storage
    .from(PDF_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf" });
  if (uploadError) return json(uploadError.message, 500);

  // A PDF with no extractable text layer (scanned images, etc.) is an
  // expected outcome, not a failure of the request — the reader falls back
  // to showing the original PDF in that case.
  let content = "";
  try {
    content = normalizeExtractedText(await extractPdf(bytes));
  } catch {
    content = "";
  }
  const parsed = content.length > 0;

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
    await supabase.storage.from(PDF_BUCKET).remove([path]);
    return json(error.message, 500);
  }
  return json({ bookmark: data });
}

// import.meta.main is only true when this file is the process entry point
// (the deployed edge function), not when index.test.ts imports handlePdfImport
// — so the test run never tries to bind a port.
if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return json("not found", 404);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );

    const body = await req.json();
    return handlePdfImport(supabase, body);
  });
}
