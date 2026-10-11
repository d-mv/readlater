import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2.110.8";
import {
  chunkText,
  deeplApiBase,
  joinChunks,
  normalizeTargetLang,
  type TextChunk,
} from "./translateLogic.ts";
import { isUuid, jsonResponse, MAX_BODY_BYTES, readJsonBody, serverError } from "../_shared/http.ts";
import { bumpRateLimit } from "../_shared/rateLimit.ts";

// apikey and x-client-info are sent on every supabase-js request (including
// functions.invoke), not just authorization/content-type — omitting them
// fails the browser's CORS preflight before the request ever reaches here.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Longest content_md this will send to DeepL (characters). Well past any
// real article; it bounds what one request can cost in DeepL quota.
export const MAX_TRANSLATE_CHARS = 200_000;

// Per DeepL request (one chunk). A hung upstream must not hold the function
// until the platform's wall-clock limit kills it.
export const DEEPL_TIMEOUT_MS = 30_000;

function json(body: unknown, status = 200): Response {
  return jsonResponse(corsHeaders, body, status);
}

// The text comes from the bookmark row, read under the caller's own session
// (RLS), never from the request: a caller can only translate — and spend
// DeepL quota on — content they actually own, and only up to the cap. A
// `text` field still sent by older clients is ignored.
export async function handleTranslate(
  supabase: SupabaseClient,
  apiKey: string | undefined,
  input: { bookmark_id?: unknown; target_lang?: unknown },
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json("unauthorized", 401);

  if (!apiKey) return serverError(corsHeaders, "translate", "DEEPL_API_KEY is not set");

  const bookmarkId = typeof input.bookmark_id === "string" ? input.bookmark_id : "";
  if (!bookmarkId) return json("bookmark_id is required", 400);
  if (!isUuid(bookmarkId)) return json("invalid bookmark_id", 400);

  const targetLang = normalizeTargetLang(
    typeof input.target_lang === "string" && input.target_lang ? input.target_lang : "EN",
  );
  if (!/^[A-Z]{2}(-[A-Z]{2,4})?$/.test(targetLang)) return json("invalid target_lang", 400);

  const { data: row, error: loadError } = await supabase
    .from("bookmarks")
    .select("content_md")
    .eq("id", bookmarkId)
    .maybeSingle();
  if (loadError) return serverError(corsHeaders, "translate:load", loadError);
  if (!row) return json("bookmark not found", 404);

  const text = typeof row.content_md === "string" ? row.content_md.trim() : "";
  if (!text) return json("nothing to translate", 400);
  if (text.length > MAX_TRANSLATE_CHARS) return json("text is too long to translate", 413);

  const limit = await bumpRateLimit(supabase, "translate");
  if (limit === "error") return json("internal error", 500);
  if (limit === "limited") return json("translation limit reached, try again later", 429);

  // One DeepL request per chunk: a long article can exceed DeepL's request
  // size limit, so it's split at paragraph boundaries and reassembled.
  const chunks = chunkText(text);
  const translatedChunks: TextChunk[] = [];
  let detectedSourceLang: string | null = null;
  for (const chunk of chunks) {
    let deeplRes: Response;
    try {
      deeplRes = await fetchImpl(`${deeplApiBase(apiKey)}/v2/translate`, {
        method: "POST",
        headers: {
          Authorization: `DeepL-Auth-Key ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: [chunk.text], target_lang: targetLang }),
        signal: AbortSignal.timeout(DEEPL_TIMEOUT_MS),
      });
    } catch (err) {
      console.error("[translate:deepl] request failed", err);
      const timedOut = err instanceof DOMException && err.name === "TimeoutError";
      return timedOut
        ? json("translation service timed out", 504)
        : json("translation service unavailable", 502);
    }

    if (!deeplRes.ok) {
      const detail = await deeplRes.text().catch(() => "");
      console.error(`[translate:deepl] HTTP ${deeplRes.status}`, detail.slice(0, 500));
      if (deeplRes.status === 429) {
        return json("translation service is busy, try again in a moment", 429);
      }
      if (deeplRes.status === 456) return json("translation quota exhausted for this month", 503);
      return json("translation failed", 502);
    }

    const body = await deeplRes.json().catch(() => null);
    const translatedText = body?.translations?.[0]?.text;
    if (typeof translatedText !== "string") {
      console.error("[translate:deepl] response without a translation", body);
      return json("translation failed", 502);
    }
    detectedSourceLang ??= body.translations[0].detected_source_lang ?? null;
    translatedChunks.push({ text: translatedText, glue: chunk.glue });
  }
  const translated = joinChunks(translatedChunks);

  // Persisted under RLS as the caller's own session, so this can only ever
  // touch a bookmark the requesting user owns — caching the result here (not
  // just returning it) is what lets a re-open skip DeepL entirely.
  const { data: updated, error: updateError } = await supabase
    .from("bookmarks")
    .update({ translated_content_md: translated, translated_lang: targetLang })
    .eq("id", bookmarkId)
    .select("id");
  if (updateError) return serverError(corsHeaders, "translate:save", updateError);
  // Deleted while DeepL was working: nothing was cached.
  if (!updated || updated.length === 0) return json("bookmark not found", 404);

  return json({
    translated_text: translated,
    translated_lang: targetLang,
    detected_source_lang: detectedSourceLang,
  });
}

export async function handleRequest(
  req: Request,
  makeClient: (authorization: string) => SupabaseClient,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json("not found", 404);

  const parsed = await readJsonBody(req, MAX_BODY_BYTES.translate, corsHeaders);
  if (!parsed.ok) return parsed.response;

  const supabase = makeClient(req.headers.get("Authorization") ?? "");
  return handleTranslate(supabase, apiKey, parsed.body, fetchImpl);
}

// import.meta.main is only true when this file is the process entry point
// (the deployed edge function), not when index.test.ts imports handleTranslate
// — so the test run never tries to bind a port.
if (import.meta.main) {
  Deno.serve((req) =>
    handleRequest(
      req,
      (authorization) =>
        createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authorization } } },
        ),
      Deno.env.get("DEEPL_API_KEY"),
    )
  );
}
