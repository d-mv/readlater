import { defineStore } from "pinia";
import { computed, shallowRef } from "vue";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

export const useAuthStore = defineStore("auth", () => {
  const session = shallowRef<Session | null>(null);

  const isAuthenticated = computed(() => session.value !== null);
  // In-memory user id for insert paths — avoids a getUser() network call.
  const userId = computed(() => session.value?.user.id ?? null);

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
        const { data } = await supabase.auth.getSession();
        session.value = data.session;

        supabase.auth.onAuthStateChange((_event, newSession) => {
          session.value = newSession;
        });
      })();
    }
    return initPromise;
  }

  async function signIn(email: string, password: string): Promise<{ error: string | null }> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    session.value = data.session;
    return { error: null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    session.value = null;
  }

  return { session, isAuthenticated, userId, init, signIn, signOut };
});
