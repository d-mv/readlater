import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { deeplApiBase, normalizeTargetLang } from "./translateLogic.ts";

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

export async function handleTranslate(
  supabase: SupabaseClient,
  apiKey: string,
  input: { bookmark_id?: unknown; text?: unknown; target_lang?: unknown },
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json("unauthorized", 401);

  const bookmarkId = typeof input.bookmark_id === "string" ? input.bookmark_id : "";
  if (!bookmarkId) return json("bookmark_id is required", 400);

  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) return json("text is empty", 400);

  const targetLang = normalizeTargetLang(
    typeof input.target_lang === "string" && input.target_lang ? input.target_lang : "EN",
  );

  const deeplRes = await fetchImpl(`${deeplApiBase(apiKey)}/v2/translate`, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: [text], target_lang: targetLang }),
  });

  if (!deeplRes.ok) return json(`DeepL error: ${await deeplRes.text()}`, 502);

  const body = await deeplRes.json();
  const translated = body?.translations?.[0]?.text;
  if (typeof translated !== "string") return json("DeepL returned no translation", 502);

  // Persisted under RLS as the caller's own session, so this can only ever
  // touch a bookmark the requesting user owns — caching the result here (not
  // just returning it) is what lets a re-open skip DeepL entirely.
  const { error: updateError } = await supabase
    .from("bookmarks")
    .update({ translated_content_md: translated, translated_lang: targetLang })
    .eq("id", bookmarkId);
  if (updateError) return json(updateError.message, 500);

  return json({
    translated_text: translated,
    translated_lang: targetLang,
    detected_source_lang: body.translations[0].detected_source_lang ?? null,
  });
}

// import.meta.main is only true when this file is the process entry point
// (the deployed edge function), not when index.test.ts imports handleTranslate
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
    return handleTranslate(supabase, Deno.env.get("DEEPL_API_KEY")!, body);
  });
}
