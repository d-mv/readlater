import { createClient } from "jsr:@supabase/supabase-js@2";
import { checkAuth } from "./checkAuth.ts";
import { detectType } from "./detectType.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!checkAuth(req.headers.get("Authorization"), Deno.env.get("CAPTURE_KEY") ?? "")) {
    return new Response("unauthorized", { status: 401, headers: corsHeaders });
  }

  const { url, title } = await req.json();
  if (typeof url !== "string" || url.length === 0) {
    return new Response("missing url", { status: 400, headers: corsHeaders });
  }

  let type: ReturnType<typeof detectType>;
  try {
    type = detectType(url);
  } catch {
    return new Response("invalid url", { status: 400, headers: corsHeaders });
  }

  const { error } = await supabase
    .from("bookmarks")
    .insert({ url, title, type, status: "pending", user_id: Deno.env.get("OWNER_USER_ID") });

  if (error) {
    return new Response(error.message, { status: 500, headers: corsHeaders });
  }

  return new Response("ok", { headers: corsHeaders });
});
