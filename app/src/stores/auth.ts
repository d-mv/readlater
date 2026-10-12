import { defineStore } from "pinia";
import { computed, shallowRef } from "vue";
import { isAuthRetryableFetchError, type AuthError, type Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import * as offlineDb from "../lib/offlineDb";
import { useBookmarksStore } from "./bookmarks";
import { useOfflineCacheStore } from "./offlineCache";

const OFFLINE_AUTH_KEY = "rl-auth-user";

interface StoredUser {
  id: string;
  email: string;
}

function loadOfflineUser(): StoredUser | null {
  try {
    const raw = localStorage.getItem(OFFLINE_AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveOfflineUser(user: StoredUser | null) {
  try {
    if (user) {
      localStorage.setItem(OFFLINE_AUTH_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(OFFLINE_AUTH_KEY);
    }
  } catch {}
}

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

// getSession() comes back without a session in two very different cases: the
// session is really over (signed out elsewhere, refresh token expired or
// revoked), or the token refresh just couldn't reach the server. Only the
// first may end the cached offline login — the second is what using the app
// offline looks like.
function sessionIsGone(error: AuthError | null): boolean {
  return isOnline() && (error === null || !isAuthRetryableFetchError(error));
}

export const useAuthStore = defineStore("auth", () => {
  const session = shallowRef<Session | null>(null);
  const offlineUser = shallowRef<StoredUser | null>(loadOfflineUser());

  const isAuthenticated = computed(() => session.value !== null || offlineUser.value !== null);
  // In-memory user id for insert paths — avoids a getUser() network call.
  const userId = computed(() => session.value?.user.id ?? offlineUser.value?.id ?? null);

  function syncUser(sess: Session | null) {
    session.value = sess;
    if (sess?.user) {
      const u = { id: sess.user.id, email: sess.user.email ?? "" };
      offlineUser.value = u;
      saveOfflineUser(u);
    }
  }

  // Drops the session and the cached offline login, which flips
  // isAuthenticated — the router sends a protected page to login on that.
  function forgetUser() {
    session.value = null;
    offlineUser.value = null;
    saveOfflineUser(null);
  }

  async function loadSession(): Promise<boolean> {
    const { data, error } = await supabase.auth.getSession();
    if (data?.session) {
      syncUser(data.session);
      return true;
    }
    if (sessionIsGone(error ?? null)) forgetUser();
    return false;
  }

  // Memoized: main.ts calls this once at boot, but the router guard also
  // calls it on every navigation to make sure it never checks
  // isAuthenticated before the session has actually loaded (a real race on a
  // cold page load, e.g. a bookmarklet-opened window) — sharing one promise
  // means that second call is a no-op await rather than a duplicate
  // getSession() round-trip and a second onAuthStateChange subscription.
  let initPromise: Promise<void> | null = null;
  function init(): Promise<void> {
    if (!initPromise) {
      initPromise = (async () => {
        try {
          await loadSession();

          supabase.auth.onAuthStateChange((event, newSession) => {
            if (event === "SIGNED_OUT") {
              forgetUser();
            } else if (newSession) {
              syncUser(newSession);
            }
          });
        } catch {
          // Offline mode: keep offlineUser and session
        }
      })();
    }
    return initPromise;
  }

  // Asks supabase-js again whether a session exists (it refreshes an expired
  // access token on the way). Called when a request finds none in memory:
  // true once one is loaded; otherwise false, and — if the session is really
  // over rather than unreachable — the cached login is dropped too.
  async function checkSession(): Promise<boolean> {
    try {
      return await loadSession();
    } catch {
      return false;
    }
  }

  // The API refused the session's token (401): it's over, whatever the
  // client still holds.
  function sessionExpired() {
    forgetUser();
  }

  async function signIn(email: string, password: string): Promise<{ error: string | null }> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    syncUser(data.session);
    return { error: null };
  }

  // Leaves nothing of this account on the device: the live channel, the
  // in-memory list and every IndexedDB store (list, sync state, downloaded
  // articles) go before the session itself. Local cleanup is best-effort and
  // never blocks the sign-out.
  async function signOut() {
    const bookmarks = useBookmarksStore();
    bookmarks.unsubscribeFromChanges();
    bookmarks.reset();
    useOfflineCacheStore().reset();
    await offlineDb.clearAll().catch(() => {});
    forgetUser();
    try {
      await supabase.auth.signOut();
    } catch {}
  }

  return {
    session,
    isAuthenticated,
    userId,
    init,
    checkSession,
    sessionExpired,
    signIn,
    signOut,
  };
});
