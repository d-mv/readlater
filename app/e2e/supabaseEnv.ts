// The dev server under test is started by playwright.config.ts with these
// values in its environment (process env wins over app/.env in Vite), so the
// suite never depends on — or talks to — a real Supabase project. `.test` is a
// reserved TLD: a request the fake backend doesn't intercept fails to resolve
// instead of reaching anything real.
export const SUPABASE_URL = "https://e2e.supabase.test";
export const SUPABASE_PUBLISHABLE_KEY = "e2e-publishable-key";

export const SUPABASE_HOST = new URL(SUPABASE_URL).host;
// supabase-js's default session storage key: `sb-<first host label>-auth-token`.
export const AUTH_STORAGE_KEY = `sb-${SUPABASE_HOST.split(".")[0]}-auth-token`;
