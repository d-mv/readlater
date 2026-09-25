import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The dev server under test reads VITE_SUPABASE_URL from app/.env; derive the
// host the app calls, and supabase-js's default session storage key
// (`sb-<first host label>-auth-token`), from the same value so the specs can't
// drift from the project the app points at.
function supabaseUrl(): string {
  if (process.env.VITE_SUPABASE_URL) return process.env.VITE_SUPABASE_URL;
  const envFile = readFileSync(fileURLToPath(new URL("../.env", import.meta.url)), "utf8");
  const match = envFile.match(/^VITE_SUPABASE_URL=(.+)$/m);
  if (!match?.[1]) throw new Error("VITE_SUPABASE_URL is not set (env or app/.env)");
  return match[1].trim().replace(/^["']|["']$/g, "");
}

export const SUPABASE_HOST = new URL(supabaseUrl()).host;
export const AUTH_STORAGE_KEY = `sb-${SUPABASE_HOST.split(".")[0]}-auth-token`;
