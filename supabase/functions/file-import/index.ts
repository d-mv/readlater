import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { Buffer } from "node:buffer";
import mammoth from "npm:mammoth";
import TurndownService from "npm:turndown";
import {
  decodeBase64,
  detectKind,
  maxBytesFor,
  readingTimeFromWordCount,
  titleFromFilename,
  truncateTitle,
  wordCount,
} from "./fileImportLogic.ts";

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

async function convertDocxToMarkdown(bytes: Uint8Array): Promise<string> {
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  return new TurndownService().turndown(html);
}

export async function handleFileImport(
  supabase: SupabaseClient,
  input: { filename?: unknown; contentBase64?: unknown },
  convertDocx: (bytes: Uint8Array) => Promise<string> = convertDocxToMarkdown,
): Promise<Response> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json("unauthorized", 401);

  const filename = typeof input.filename === "string" ? input.filename : "";
  const contentBase64 = typeof input.contentBase64 === "string" ? input.contentBase64 : "";
  if (!filename || !contentBase64) return json("file is empty", 400);

  const kind = detectKind(filename);
  if (!kind) return json("unsupported file type — use .md, .markdown, or .docx", 400);

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(contentBase64);
  } catch {
    return json("file could not be decoded", 400);
  }

  if (bytes.byteLength > maxBytesFor(kind)) {
    const limit = kind === "markdown" ? "500KB" : "5MB";
    return json(`file exceeds the ${limit} limit for this file type`, 400);
  }

  let content: string;
  if (kind === "markdown") {
    content = new TextDecoder().decode(bytes).trim();
  } else {
    try {
      content = (await convertDocx(bytes)).trim();
    } catch {
      return json("could not parse Word document", 400);
    }
  }
  if (!content) return json("file is empty", 400);

  const words = wordCount(content);
  const title = truncateTitle(titleFromFilename(filename));

  const { data, error } = await supabase
    .from("bookmarks")
    .insert({
      url: null,
      title,
      content_md: content,
      type: "note",
      status: "ready",
      word_count: words,
      reading_time: readingTimeFromWordCount(words),
      user_id: user.id,
    })
    .select("*, tags(id, name, color)")
    .single();

  if (error) return json(error.message, 500);
  return json({ bookmark: data });
}

// import.meta.main is only true when this file is the process entry point
// (the deployed edge function), not when index.test.ts imports handleFileImport
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
    return handleFileImport(supabase, body);
  });
}
