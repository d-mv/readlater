import type { SupabaseClient } from "jsr:@supabase/supabase-js@2.110.8";

// Per-user fixed-window limits, enforced in Postgres by bump_rate_limit()
// (20261011171000_audit_hardening.sql): one atomic upsert per call, so
// concurrent requests can't both slip under the limit.
export const RATE_LIMITS = {
  capture: { max: 120, window: "1 hour" },
  translate: { max: 20, window: "1 hour" },
  snippet: { max: 30, window: "1 hour" },
  "file-import": { max: 30, window: "1 hour" },
  "pdf-import": { max: 30, window: "1 hour" },
} as const;

export type RateLimitedAction = keyof typeof RATE_LIMITS;

// "error" covers both an RPC failure and an RPC that answered with nothing —
// a bump that didn't record anything must not be treated as "allowed".
export type RateLimitOutcome = "allowed" | "limited" | "error";

// JWT-authed functions: bump_rate_limit keys the counter on auth.uid() of the
// caller's own session. Service-role callers (capture, which authenticates
// with CAPTURE_KEY and writes as OWNER_USER_ID) pass userId and go through
// bump_rate_limit_for_user, which only service_role may execute.
export async function bumpRateLimit(
  supabase: SupabaseClient,
  action: RateLimitedAction,
  userId?: string,
): Promise<RateLimitOutcome> {
  const { max, window } = RATE_LIMITS[action];
  const { data, error } = userId
    ? await supabase.rpc("bump_rate_limit_for_user", {
      p_user_id: userId,
      p_action: action,
      p_max: max,
      p_window: window,
    })
    : await supabase.rpc("bump_rate_limit", { p_action: action, p_max: max, p_window: window });

  if (error) {
    console.error(`[rate-limit:${action}]`, error);
    return "error";
  }
  if (data === true) return "allowed";
  if (data === false) return "limited";
  console.error(`[rate-limit:${action}] unexpected RPC result`, data);
  return "error";
}
