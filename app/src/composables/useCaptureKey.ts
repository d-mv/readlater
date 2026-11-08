import { onScopeDispose, shallowRef } from "vue";
import { supabase } from "../lib/supabase";

// What the owner may read of their capture key (column privileges on
// capture_keys allow only these two; the hash never reaches the client).
export interface CaptureKeyInfo {
  created_at: string;
  last_used_at: string | null;
}

export type CaptureKeyState =
  | { status: "loading" }
  | { status: "error"; message: string }
  // `key` is null until the first key is generated.
  | { status: "ready"; key: CaptureKeyInfo | null };

export const CAPTURE_KEY_LOAD_FAILED =
  "Couldn't load your capture key. Check your connection and try again.";
export const CAPTURE_KEY_ROTATE_FAILED =
  "Couldn't generate a new key. Check your connection and try again.";
export const CAPTURE_KEY_RATE_LIMITED = "Too many new keys in the last hour. Try again later.";

// rotate_capture_key() raises SQLSTATE PT429 (HTTP 429) over its limit.
const RATE_LIMITED_CODE = "PT429";

async function fetchInfo(): Promise<CaptureKeyState> {
  try {
    const { data, error } = await supabase
      .from("capture_keys")
      .select("created_at, last_used_at")
      .maybeSingle();
    if (error) return { status: "error", message: CAPTURE_KEY_LOAD_FAILED };
    return { status: "ready", key: (data as CaptureKeyInfo | null) ?? null };
  } catch {
    return { status: "error", message: CAPTURE_KEY_LOAD_FAILED };
  }
}

export function useCaptureKey() {
  const state = shallowRef<CaptureKeyState>({ status: "loading" });
  // The plaintext of a key just generated: shown once, held only here (never
  // in localStorage/IndexedDB) and dropped on dismiss or when the page goes.
  const generated = shallowRef<string | null>(null);
  const rotating = shallowRef(false);
  const rotateError = shallowRef<string | null>(null);

  async function load(): Promise<void> {
    state.value = { status: "loading" };
    state.value = await fetchInfo();
  }

  async function rotate(): Promise<void> {
    if (rotating.value) return;
    rotating.value = true;
    rotateError.value = null;
    generated.value = null;
    let key: string | null = null;
    try {
      const { data, error } = await supabase.rpc("rotate_capture_key");
      if (error) {
        rotateError.value =
          error.code === RATE_LIMITED_CODE ? CAPTURE_KEY_RATE_LIMITED : CAPTURE_KEY_ROTATE_FAILED;
      } else if (typeof data !== "string" || data === "") {
        rotateError.value = CAPTURE_KEY_ROTATE_FAILED;
      } else {
        key = data;
      }
    } catch {
      rotateError.value = CAPTURE_KEY_ROTATE_FAILED;
    }
    if (key === null) {
      rotating.value = false;
      return;
    }
    generated.value = key;
    // The server's dates; if that read fails, the key is still new and unused.
    const refreshed = await fetchInfo();
    state.value =
      refreshed.status === "ready"
        ? refreshed
        : { status: "ready", key: { created_at: new Date().toISOString(), last_used_at: null } };
    rotating.value = false;
  }

  function dismiss() {
    generated.value = null;
  }

  onScopeDispose(dismiss);

  return { state, generated, rotating, rotateError, load, rotate, dismiss };
}
