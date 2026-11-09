import { shallowRef } from "vue";
import { supabase } from "../lib/supabase";

// One row of the owner's security_events (written by database triggers; RLS
// scopes the read to the signed-in user). `detail` depends on `kind`:
// sign_in → user_agent / ip; bookmark events → bookmark_id / title.
export type SecurityEventKind =
  | "sign_in"
  | "capture_key_rotated"
  | "link_shared"
  | "link_unshared"
  | "bookmark_deleted";

export interface SecurityEvent {
  id: number;
  kind: SecurityEventKind;
  detail: {
    user_agent?: string;
    ip?: string;
    bookmark_id?: string;
    title?: string | null;
  };
  created_at: string;
}

export type SecurityEventsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; events: SecurityEvent[] };

export const SECURITY_EVENTS_LOAD_FAILED =
  "Couldn't load your security activity. Check your connection and try again.";

// The newest events are what someone checks; older ones (kept 90 days) are
// rarely wanted on a phone screen.
export const SECURITY_EVENTS_SHOWN = 50;

const EVENT_COLUMNS = "id, kind, detail, created_at";

// "Firefox on Linux" from a user agent; the parts it can't tell are left out
// ("Firefox", "Linux"), and null when it can tell neither.
export function describeDevice(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : null;
  const os = /Android/.test(userAgent)
    ? "Android"
    : /Windows/.test(userAgent)
      ? "Windows"
      : /CrOS/.test(userAgent)
        ? "ChromeOS"
        : /Mac OS X|Macintosh/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os;
}

// The line a Settings row shows for an event.
export function describeEvent(event: SecurityEvent): string {
  const title = `“${event.detail.title || "Untitled"}”`;
  switch (event.kind) {
    case "sign_in": {
      const where = [describeDevice(event.detail.user_agent), event.detail.ip].filter(Boolean);
      return where.length ? `Signed in · ${where.join(" · ")}` : "Signed in";
    }
    case "capture_key_rotated":
      return "New capture key generated";
    case "link_shared":
      return `Shared ${title}`;
    case "link_unshared":
      return `Stopped sharing ${title}`;
    case "bookmark_deleted":
      return `Deleted ${title}`;
  }
}

export function useSecurityEvents() {
  const state = shallowRef<SecurityEventsState>({ status: "loading" });
  // Bumped by every load, so an older read can't overwrite a newer one.
  let generation = 0;

  async function load(): Promise<void> {
    const current = ++generation;
    state.value = { status: "loading" };
    let next: SecurityEventsState;
    try {
      const { data, error } = await supabase
        .from("security_events")
        .select(EVENT_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(SECURITY_EVENTS_SHOWN);
      next = error
        ? { status: "error", message: SECURITY_EVENTS_LOAD_FAILED }
        : { status: "ready", events: (data ?? []) as SecurityEvent[] };
    } catch {
      next = { status: "error", message: SECURITY_EVENTS_LOAD_FAILED };
    }
    if (current === generation) state.value = next;
  }

  return { state, load };
}
