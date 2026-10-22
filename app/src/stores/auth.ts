import { defineStore } from "pinia";
import { computed, shallowRef } from "vue";
import { isAuthRetryableFetchError, type AuthError, type Session } from "@supabase/supabase-js";
import { AUTH_STORAGE_KEY, supabase } from "../lib/supabase";
import * as offlineDb from "../lib/offlineDb";
import { useBookmarksStore } from "./bookmarks";
import { useOfflineCacheStore } from "./offlineCache";

const OFFLINE_AUTH_KEY = "rl-auth-user";
// The user whose list, sync state and downloads IndexedDB holds. Unlike
// rl-auth-user it survives a session that ends without Sign out, so the
// next sign-in can tell whether that data is its own.
const DATA_OWNER_KEY = "rl-data-owner";

export const SIGN_IN_UNCONFIRMED = "Check your email to confirm your account, then sign in.";

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

function loadDataOwner(): string | null {
  try {
    return localStorage.getItem(DATA_OWNER_KEY);
  } catch {
    return null;
  }
}

function saveDataOwner(id: string | null) {
  try {
    if (id) localStorage.setItem(DATA_OWNER_KEY, id);
    else localStorage.removeItem(DATA_OWNER_KEY);
  } catch {}
}

function removeStoredSession() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
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

  // The live channel and the in-memory list belong to the session that loaded
  // them; they go whenever it ends.
  function dropLocalState() {
    const bookmarks = useBookmarksStore();
    bookmarks.unsubscribeFromChanges();
    bookmarks.reset();
    useOfflineCacheStore().reset();
  }

  // Everything of the current account on the device, IndexedDB included.
  // Best-effort: false when IndexedDB couldn't be cleared.
  async function clearDevice(): Promise<boolean> {
    dropLocalState();
    try {
      await offlineDb.clearAll();
      saveDataOwner(null);
      return true;
    } catch {
      return false;
    }
  }

  // A different user signing in on this device must never see the previous
  // user's IndexedDB data. The owner changes only once that data is gone, so
  // a failed clear is retried at the next sign-in.
  let ownerSwitch: Promise<void> = Promise.resolve();
  function claimDevice(userId: string) {
    const owner = loadDataOwner();
    if (owner === userId) return;
    if (owner === null) {
      saveDataOwner(userId);
      return;
    }
    ownerSwitch = clearDevice().then((cleared) => {
      if (cleared) saveDataOwner(userId);
    });
  }

  function syncUser(sess: Session) {
    claimDevice(sess.user.id);
    session.value = sess;
    const u = { id: sess.user.id, email: sess.user.email ?? "" };
    offlineUser.value = u;
    saveOfflineUser(u);
  }

  // Drops the session and the cached offline login, which flips
  // isAuthenticated — the router sends a protected page to login on that.
  function endSession() {
    session.value = null;
    offlineUser.value = null;
    saveOfflineUser(null);
  }

  // The session ended without Sign out (expired, signed out in another tab):
  // the in-memory state goes too. IndexedDB stays for the same user's next
  // sign-in; claimDevice clears it if someone else signs in.
  function forgetUser() {
    dropLocalState();
    endSession();
  }

  async function loadSession(): Promise<boolean> {
    const { data, error } = await supabase.auth.getSession();
    if (data?.session) {
      syncUser(data.session);
      await ownerSwitch;
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
    // An unconfirmed account comes back as Auth's terse "Email not
    // confirmed"; say what to do instead. No session without an error means
    // the same (the password matched, the confirmation link is still
    // pending) — without this the form would report success and stay put.
    if (error?.code === "email_not_confirmed") return { error: SIGN_IN_UNCONFIRMED };
    if (error) return { error: error.message };
    if (!data.session) return { error: SIGN_IN_UNCONFIRMED };
    syncUser(data.session);
    await ownerSwitch;
    return { error: null };
  }

  // Leaves nothing of this account on the device: the live channel, the
  // in-memory list and every IndexedDB store (list, sync state, downloaded
  // articles) go before the session itself. Local cleanup is best-effort and
  // never blocks the sign-out.
  async function signOut() {
    await clearDevice();
    endSession();
    // supabase-js refreshes an expired token before signing out and, if that
    // refresh can't reach the server, returns without removing the stored
    // session — the next online load would then restore it. So the stored
    // session is removed here too. Offline that happens first: the server
    // can't be told anyway, and with no session left supabase-js skips the
    // doomed refresh (retried with backoff for up to ~30 s).
    if (!isOnline()) removeStoredSession();
    try {
      await supabase.auth.signOut();
    } catch {}
    removeStoredSession();
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
