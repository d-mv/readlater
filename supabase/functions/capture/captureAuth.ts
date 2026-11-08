import type { SupabaseClient } from "jsr:@supabase/supabase-js@2.118.0";
import { bearerToken, checkAuth } from "../_shared/checkAuth.ts";

// Who a capture request is from. A capture client sends a per-user key made
// by rotate_capture_key() (Settings → Capture key); capture_keys stores only
// its sha256, so the token is hashed and looked up with the service-role
// client, and that row's user_id is who the capture is written as.
//
// Transition: a token no row matches is still accepted when it equals the
// legacy CAPTURE_KEY secret (constant-time), as OWNER_USER_ID — but only
// while that owner has no capture_keys row. Generating the first key in
// Settings therefore retires the static key.

// Generated keys are 47 chars; anything far past that isn't one of ours and
// isn't worth hashing.
export const CAPTURE_KEY_MAX_CHARS = 256;

export type CallerResolution =
  | { kind: "user"; userId: string; source: "key" | "env" }
  | { kind: "unauthorized" }
  | { kind: "error"; cause: unknown };

// Lowercase hex sha256 of the UTF-8 text — what the migration stores
// (encode(sha256(convert_to(key, 'UTF8')), 'hex')).
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(
    new Uint8Array(digest),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function resolveCaller(
  client: SupabaseClient,
  authHeader: string | null,
  env: { captureKey: string; ownerUserId: string | undefined },
): Promise<CallerResolution> {
  const token = bearerToken(authHeader);
  if (token === null || token.length > CAPTURE_KEY_MAX_CHARS) {
    return { kind: "unauthorized" };
  }

  // Every well-formed token gets the same hash + indexed lookup, so a wrong
  // key and a right one differ only in the answer.
  const { data: keyRow, error: keyError } = await client
    .from("capture_keys")
    .select("user_id")
    .eq("key_hash", await sha256Hex(token))
    .maybeSingle();
  if (keyError) return { kind: "error", cause: keyError };
  if (keyRow) return { kind: "user", userId: keyRow.user_id, source: "key" };

  if (!checkAuth(authHeader, env.captureKey)) return { kind: "unauthorized" };
  if (!env.ownerUserId) {
    return { kind: "error", cause: "OWNER_USER_ID is not set" };
  }

  const { data: ownerKey, error: ownerError } = await client
    .from("capture_keys")
    .select("user_id")
    .eq("user_id", env.ownerUserId)
    .maybeSingle();
  if (ownerError) return { kind: "error", cause: ownerError };
  // The owner has generated a key: the static one is retired.
  if (ownerKey) return { kind: "unauthorized" };
  return { kind: "user", userId: env.ownerUserId, source: "env" };
}

// Best-effort: Settings shows when the key was last used, but a failed write
// must never fail the capture it belongs to.
export async function markKeyUsed(
  client: SupabaseClient,
  userId: string,
  now = new Date(),
): Promise<void> {
  try {
    const { error } = await client
      .from("capture_keys")
      .update({ last_used_at: now.toISOString() })
      .eq("user_id", userId);
    if (error) console.error("[capture:last-used]", error);
  } catch (err) {
    console.error("[capture:last-used]", err);
  }
}
