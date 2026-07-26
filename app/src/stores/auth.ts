import { defineStore } from "pinia";
import { computed, shallowRef } from "vue";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

export const useAuthStore = defineStore("auth", () => {
  const session = shallowRef<Session | null>(null);

  const isAuthenticated = computed(() => session.value !== null);

  async function init() {
    const { data } = await supabase.auth.getSession();
    session.value = data.session;

    supabase.auth.onAuthStateChange((_event, newSession) => {
      session.value = newSession;
    });
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

  return { session, isAuthenticated, init, signIn, signOut };
});
