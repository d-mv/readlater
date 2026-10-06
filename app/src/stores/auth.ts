import { defineStore } from "pinia";
import { computed, shallowRef } from "vue";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

const OFFLINE_AUTH_KEY = "rl-auth-user";

interface StoredUser {
  id: string;
  email: string;
}

function loadOfflineUser(): StoredUser | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(OFFLINE_AUTH_KEY) : null;
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveOfflineUser(user: StoredUser | null) {
  try {
    if (typeof localStorage === "undefined") return;
    if (user) {
      localStorage.setItem(OFFLINE_AUTH_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(OFFLINE_AUTH_KEY);
    }
  } catch {}
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
          const { data } = await supabase.auth.getSession();
          if (data?.session) {
            syncUser(data.session);
          }

          supabase.auth.onAuthStateChange((event, newSession) => {
            if (event === "SIGNED_OUT") {
              session.value = null;
              offlineUser.value = null;
              saveOfflineUser(null);
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

  async function signIn(email: string, password: string): Promise<{ error: string | null }> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    syncUser(data.session);
    return { error: null };
  }

  async function signOut() {
    offlineUser.value = null;
    saveOfflineUser(null);
    try {
      await supabase.auth.signOut();
    } catch {}
    session.value = null;
  }

  return { session, isAuthenticated, userId, init, signIn, signOut };
});
