import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2.110.8";
import { resolveContent } from "./snippetLogic.ts";
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

export async function handleSnippet(
  supabase: SupabaseClient,
  input: { html?: unknown; text?: unknown },
): Promise<Response> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json("unauthorized", 401);

  const html = typeof input.html === "string" ? input.html : "";
  const text = typeof input.text === "string" ? input.text : "";
  if (!html.trim() && !text.trim()) return json("snippet is empty", 400);

  const limit = await bumpRateLimit(supabase, "snippet");
  if (limit === "error") return json("internal error", 500);
  if (limit === "limited") return json("rate limit exceeded, try again later", 429);

  const converted = html ? createTurndownService().turndown(html) : "";
  const content = resolveContent(converted, text);
  if (!content) return json("snippet is empty", 400);

  const { data, error } = await supabase
    .from("bookmarks")
    .insert(readyNoteRow({ userId: user.id, content }))
    .select("*, tags(id, name, color)")
    .single();

  if (error) return serverError(corsHeaders, "snippet:insert", error);
  return json({ bookmark: data });
}

export async function handleRequest(
  req: Request,
  makeClient: (authorization: string) => SupabaseClient,
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json("not found", 404);

  const parsed = await readJsonBody(req, MAX_BODY_BYTES.snippet, corsHeaders);
  if (!parsed.ok) return parsed.response;

  return handleSnippet(makeClient(req.headers.get("Authorization") ?? ""), parsed.body);
}

// import.meta.main is only true when this file is the process entry point
// (the deployed edge function), not when index.test.ts imports handleSnippet
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
