import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { checkAuth } from "./checkAuth.ts";
import { detectType } from "./detectType.ts";
import { hasAllowedScheme, isBareUrl, normalizeUrl, truncateTitle } from "./captureLogic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
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
  ownerUserId: string | undefined,
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
    return json(error.message, 500);
  }

  return json({ status: "created", id: data.id });
}

async function insertReadyNote(
  client: SupabaseClient,
  ownerUserId: string | undefined,
  text: string,
): Promise<Response> {
  const { data, error } = await client
    .from("bookmarks")
    .insert({
      url: null,
      title: truncateTitle(text),
      content_md: text,
      type: "note",
      status: "ready",
      user_id: ownerUserId,
    })
    .select("id")
    .single();

  if (error) return json(error.message, 500);
  return json({ status: "created", id: data.id });
}

async function handleCapture(
  client: SupabaseClient,
  ownerUserId: string | undefined,
  input: { url?: unknown; title?: unknown; text?: unknown },
): Promise<Response> {
  const url = typeof input.url === "string" ? input.url.trim() : undefined;
  const title = typeof input.title === "string" ? input.title : undefined;
  const text = typeof input.text === "string" ? input.text.trim() : undefined;

  if (url) {
    if (!hasAllowedScheme(url)) return json("invalid url", 400);
    return insertPendingUrl(client, ownerUserId, url, title);
  }

  if (text && isBareUrl(text)) return insertPendingUrl(client, ownerUserId, text, title);
  if (text) return insertReadyNote(client, ownerUserId, text);

  return json("capture requires url or text", 400);
}

export async function handleRefresh(
  client: SupabaseClient,
  id: string,
  force: boolean,
): Promise<Response> {
  if (!force) {
    const { data } = await client.from("bookmarks").select("content_edited").eq("id", id).maybeSingle();
    if (data?.content_edited) return json({ status: "confirm_required" }, 409);
  }

  const { error } = await client
    .from("bookmarks")
    .update({ status: "pending", error_message: null, content_edited: false })
    .eq("id", id)
    .not("url", "is", null); // notes never dedupe, so this should never target a note; belt and suspenders.

  if (error) return json(error.message, 500);
  return json({ status: "ok" });
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
  const OWNER_USER_ID = Deno.env.get("OWNER_USER_ID");

  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (!checkAuth(req.headers.get("Authorization"), Deno.env.get("CAPTURE_KEY") ?? "")) {
      return new Response("unauthorized", { status: 401, headers: corsHeaders });
    }

    const pathSegments = new URL(req.url).pathname.split("/").filter(Boolean);
    const captureIdx = pathSegments.indexOf("capture");
    const rest = captureIdx >= 0 ? pathSegments.slice(captureIdx + 1) : [];

    if (req.method === "POST" && rest.length === 2 && rest[1] === "refresh") {
      let force = false;
      try {
        force = (await req.json())?.force === true;
      } catch {
        // No body (or non-JSON body) sent — treat as an unconfirmed request.
      }
      return handleRefresh(supabase, rest[0], force);
    }

    if (req.method !== "POST" || rest.length !== 0) {
      return new Response("not found", { status: 404, headers: corsHeaders });
    }

    const body = await req.json();
    return handleCapture(supabase, OWNER_USER_ID, body);
  });
}
