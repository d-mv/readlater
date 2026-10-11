import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2.110.8";
import { checkAuth } from "../_shared/checkAuth.ts";
import { detectType } from "./detectType.ts";
import { hasAllowedScheme, isBareUrl, normalizeUrl } from "./captureLogic.ts";
import { readyNoteRow } from "../_shared/noteRow.ts";
import { isUuid, jsonResponse, MAX_BODY_BYTES, readJsonBody, serverError } from "../_shared/http.ts";
import { bumpRateLimit } from "../_shared/rateLimit.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Field caps on top of the 1 MB body cap: a title is display text (cut, not
// rejected); a URL or note body past these is not a real capture.
export const MAX_TITLE_CHARS = 500;
export const MAX_URL_CHARS = 8192;
export const MAX_TEXT_CHARS = 200_000;

function json(body: unknown, status = 200): Response {
  return jsonResponse(corsHeaders, body, status);
}

async function findByNormalizedUrl(client: SupabaseClient, url: string) {
  const { data } = await client
    .from("bookmarks")
    .select("id, title, created_at")
    .eq("url_normalized", normalizeUrl(url))
    .maybeSingle();
  return data;
}

async function insertPendingUrl(
  client: SupabaseClient,
  ownerUserId: string,
  url: string,
  title?: string,
): Promise<Response> {
  let type: ReturnType<typeof detectType>;
  try {
    type = detectType(url);
  } catch {
    return json("invalid url", 400);
  }

  const { data, error } = await client
    .from("bookmarks")
    .insert({ url, title, type, status: "pending", user_id: ownerUserId })
    .select("id")
    .single();

  if (error) {
    // 23505 = unique_violation on bookmarks_url_normalized_uniq: someone
    // already saved this URL. Report it as a conflict for the client to
    // resolve, rather than a generic 500.
    if (error.code === "23505") {
      const existing = await findByNormalizedUrl(client, url);
      if (existing) {
        return json({
          status: "duplicate",
          existingId: existing.id,
          existingTitle: existing.title,
          existingSavedAt: existing.created_at,
        });
      }
    }
    return serverError(corsHeaders, "capture:insert-url", error);
  }

  return json({ status: "created", id: data.id });
}

export async function insertReadyNote(
  client: SupabaseClient,
  ownerUserId: string,
  text: string,
): Promise<Response> {
  const { data, error } = await client
    .from("bookmarks")
    .insert(readyNoteRow({ userId: ownerUserId, content: text }))
    .select("id")
    .single();

  if (error) return serverError(corsHeaders, "capture:insert-note", error);
  return json({ status: "created", id: data.id });
}

export async function handleCapture(
  client: SupabaseClient,
  ownerUserId: string | undefined,
  input: { url?: unknown; title?: unknown; text?: unknown },
): Promise<Response> {
  if (!ownerUserId) return serverError(corsHeaders, "capture", "OWNER_USER_ID is not set");

  const url = typeof input.url === "string" ? input.url.trim() : undefined;
  const title = typeof input.title === "string"
    ? input.title.slice(0, MAX_TITLE_CHARS)
    : undefined;
  const text = typeof input.text === "string" ? input.text.trim() : undefined;

  if (url && url.length > MAX_URL_CHARS) return json("url is too long", 400);
  if (!url && text && text.length > MAX_TEXT_CHARS) return json("text is too long", 413);
  if (url && !hasAllowedScheme(url)) return json("invalid url", 400);
  if (!url && !text) return json("capture requires url or text", 400);

  const limit = await bumpRateLimit(client, "capture", ownerUserId);
  if (limit === "error") return json("internal error", 500);
  if (limit === "limited") return json("rate limit exceeded, try again later", 429);

  if (url) return insertPendingUrl(client, ownerUserId, url, title);
  if (text && isBareUrl(text)) return insertPendingUrl(client, ownerUserId, text, title);
  return insertReadyNote(client, ownerUserId, text!);
}

export async function handleRefresh(
  client: SupabaseClient,
  ownerUserId: string | undefined,
  id: string,
  force: boolean,
): Promise<Response> {
  if (!ownerUserId) return serverError(corsHeaders, "capture:refresh", "OWNER_USER_ID is not set");
  if (!isUuid(id)) return json("invalid bookmark id", 400);

  const limit = await bumpRateLimit(client, "capture", ownerUserId);
  if (limit === "error") return json("internal error", 500);
  if (limit === "limited") return json("rate limit exceeded, try again later", 429);

  if (!force) {
    const { data } = await client.from("bookmarks").select("content_edited").eq("id", id).maybeSingle();
    if (data?.content_edited) return json({ status: "confirm_required" }, 409);
  }

  const { data, error } = await client
    .from("bookmarks")
    .update({ status: "pending", error_message: null, content_edited: false })
    .eq("id", id)
    .not("url", "is", null) // notes never dedupe, so this should never target a note; belt and suspenders.
    .select("id");

  if (error) return serverError(corsHeaders, "capture:refresh", error);
  // Nothing updated: no such bookmark (or a note) — not a successful refresh.
  if (!data || data.length === 0) return json("bookmark not found", 404);
  return json({ status: "ok" });
}

export async function handleRequest(
  req: Request,
  client: SupabaseClient,
  env: { captureKey: string; ownerUserId: string | undefined },
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!checkAuth(req.headers.get("Authorization"), env.captureKey)) {
    return new Response("unauthorized", { status: 401, headers: corsHeaders });
  }

  const pathSegments = new URL(req.url).pathname.split("/").filter(Boolean);
  const captureIdx = pathSegments.indexOf("capture");
  const rest = captureIdx >= 0 ? pathSegments.slice(captureIdx + 1) : [];

  if (req.method === "POST" && rest.length === 2 && rest[1] === "refresh") {
    // The body is optional here: no body (or a non-JSON one) is an
    // unconfirmed request. Only an oversize body is refused.
    const parsed = await readJsonBody(req, MAX_BODY_BYTES.capture, corsHeaders);
    if (!parsed.ok && parsed.status === 413) return parsed.response;
    const force = parsed.ok && parsed.body.force === true;
    return handleRefresh(client, env.ownerUserId, rest[0], force);
  }

  if (req.method !== "POST" || rest.length !== 0) {
    return new Response("not found", { status: 404, headers: corsHeaders });
  }

  const parsed = await readJsonBody(req, MAX_BODY_BYTES.capture, corsHeaders);
  if (!parsed.ok) return parsed.response;
  return handleCapture(client, env.ownerUserId, parsed.body);
}

// import.meta.main is only true when this file is the process entry point
// (the deployed edge function), not when index.test.ts imports the handlers
// — so the test run never tries to construct a client from unset env vars
// or bind a port.
if (import.meta.main) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  Deno.serve((req) =>
    handleRequest(req, supabase, {
      captureKey: Deno.env.get("CAPTURE_KEY") ?? "",
      ownerUserId: Deno.env.get("OWNER_USER_ID"),
    })
  );
}
