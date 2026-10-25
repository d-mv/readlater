import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2.118.0";
import { Buffer } from "node:buffer";
import mammoth from "npm:mammoth@1.12.0";
import { detectKind, maxBytesFor } from "./fileImportLogic.ts";
import { decodeBase64, titleFromFilename } from "../_shared/file.ts";
import { readyNoteRow } from "../_shared/noteRow.ts";
import { createTurndownService } from "../_shared/turndown.ts";
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

async function convertDocxToMarkdown(bytes: Uint8Array): Promise<string> {
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  return createTurndownService().turndown(html);
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

  const limit = await bumpRateLimit(supabase, "file-import");
  if (limit === "error") return json("internal error", 500);
  if (limit === "limited") return json("rate limit exceeded, try again later", 429);

  let content: string;
  if (kind === "markdown") {
    content = new TextDecoder().decode(bytes).trim();
  } else {
    try {
      content = (await convertDocx(bytes)).trim();
    } catch (err) {
      console.error("[file-import:docx]", err);
      return json("could not parse Word document", 400);
    }
  }
  if (!content) return json("file is empty", 400);

  const { data, error } = await supabase
    .from("bookmarks")
    .insert(readyNoteRow({ userId: user.id, content, title: titleFromFilename(filename) }))
    .select("*, tags(id, name, color)")
    .single();

  if (error) return serverError(corsHeaders, "file-import:insert", error);
  return json({ bookmark: data });
}

export async function handleRequest(
  req: Request,
  makeClient: (authorization: string) => SupabaseClient,
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json("not found", 404);

  const parsed = await readJsonBody(req, MAX_BODY_BYTES.fileImport, corsHeaders);
  if (!parsed.ok) return parsed.response;

  return handleFileImport(makeClient(req.headers.get("Authorization") ?? ""), parsed.body);
}

// The deployed request handler, wired to the environment: each request gets
// a client acting as the caller (their Authorization header, so RLS applies).
// Exported so the tests can exercise the env wiring without binding a port.
export function handlerFromEnv(): (req: Request) => Promise<Response> {
  return (req) =>
    handleRequest(req, (authorization) =>
      createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authorization } } },
      ));
}

// import.meta.main is only true when this file is the process entry point
// (the deployed edge function), not when index.test.ts imports handleFileImport
// — so the test run never binds a port. The one line tests can't reach.
// deno-coverage-ignore
if (import.meta.main) Deno.serve(handlerFromEnv());
