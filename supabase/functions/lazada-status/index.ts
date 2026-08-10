import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const { data: tok, error } = await supabase.from("lazada_tokens").select("*").eq("id", 1).single();
  const connected = Boolean(tok && tok.access_token && tok.refresh_token);
  const now = Date.now();
  const expired = connected && tok.expires_at
    ? new Date(tok.expires_at).getTime() < now
    : false;
  const refreshExpired = connected && tok.refresh_expires_at
    ? new Date(tok.refresh_expires_at).getTime() < now
    : false;

  return new Response(JSON.stringify({
    ok: true,
    connected,
    expired,
    refresh_expired: refreshExpired,
    connected_at: tok?.updated_at ?? null,
    last_synced_at: tok?.last_synced_at ?? null,
    access_expires_at: tok?.expires_at ?? null,
    refresh_expires_at: tok?.refresh_expires_at ?? null,
  }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
