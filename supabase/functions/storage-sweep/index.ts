import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2.118.0";
import { checkAuth } from "../_shared/checkAuth.ts";
import { jsonResponse, serverError } from "../_shared/http.ts";

// Backstop for Storage objects no bookmark references any more: a PDF whose
// bookmark was deleted (the app removes the file on delete, but a failed or
// interrupted removal leaves it behind), a pdf-import whose cleanup after a
// failed insert also failed, a YouTube thumbnail whose bookmark is gone.
//
// Postgres decides what is orphaned (list_orphaned_storage_objects(), in
// 20261011171000_audit_hardening.sql — only service_role may execute it);
// the objects are then removed through the Storage API, since Supabase
// refuses direct deletes from storage.objects.
//
// Service-role only: the caller must present the project's service-role key
// as a bearer token. Meant to be run on a schedule (pg_cron + pg_net, see
// the migration), not from the app.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Storage's remove() takes at most 1000 paths per call.
const REMOVE_BATCH = 500;

function json(body: unknown, status = 200): Response {
  return jsonResponse(corsHeaders, body, status);
}

interface OrphanRow {
  bucket_id: string;
  name: string;
}

export async function sweep(
  admin: SupabaseClient,
  options: { dryRun: boolean },
): Promise<Response> {
  const { data, error } = await admin.rpc("list_orphaned_storage_objects");
  if (error) return serverError(corsHeaders, "storage-sweep:list", error);
  if (!Array.isArray(data)) return serverError(corsHeaders, "storage-sweep:list", data);

  const byBucket = new Map<string, string[]>();
  for (const row of data as OrphanRow[]) {
    const names = byBucket.get(row.bucket_id) ?? [];
    names.push(row.name);
    byBucket.set(row.bucket_id, names);
  }

  const found = Object.fromEntries([...byBucket].map(([bucket, names]) => [bucket, names.length]));
  if (options.dryRun) return json({ dry_run: true, found });

  const removed: Record<string, number> = {};
  for (const [bucket, names] of byBucket) {
    removed[bucket] = 0;
    for (let i = 0; i < names.length; i += REMOVE_BATCH) {
      const batch = names.slice(i, i + REMOVE_BATCH);
      const { data: gone, error: removeError } = await admin.storage.from(bucket).remove(batch);
      if (removeError) return serverError(corsHeaders, `storage-sweep:remove:${bucket}`, removeError);
      removed[bucket] += gone?.length ?? 0;
    }
  }
  console.log("[storage-sweep] removed", removed);
  return json({ dry_run: false, found, removed });
}

export async function handleRequest(
  req: Request,
  admin: SupabaseClient,
  serviceRoleKey: string,
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json("not found", 404);

  if (!checkAuth(req.headers.get("Authorization"), serviceRoleKey)) {
    return json("unauthorized", 401);
  }

  const dryRun = new URL(req.url).searchParams.get("dry_run") === "1";
  return sweep(admin, { dryRun });
}

// The deployed request handler, wired to the environment. Exported so the
// tests can exercise the env wiring without binding a port.
export function handlerFromEnv(): (req: Request) => Promise<Response> {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return (req) => handleRequest(req, admin, serviceRoleKey);
}

// import.meta.main is only true when this file is the process entry point
// (the deployed edge function), not when index.test.ts imports handleRequest
// — so the test run never binds a port. The one line tests can't reach.
// deno-coverage-ignore
if (import.meta.main) Deno.serve(handlerFromEnv());
