import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import TurndownService from "npm:turndown";
import { readingTimeFromWordCount, resolveContent, truncateTitle, wordCount } from "./snippetLogic.ts";

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
  const converted = html ? new TurndownService().turndown(html) : "";
  const content = resolveContent(converted, text);
  if (!content) return json("snippet is empty", 400);

  const words = wordCount(content);

  const { data, error } = await supabase
    .from("bookmarks")
    .insert({
      url: null,
      title: truncateTitle(content),
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
// (the deployed edge function), not when index.test.ts imports handleSnippet
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
    return handleSnippet(supabase, body);
  });
}
