import { createClient } from "npm:@supabase/supabase-js@2";

const APP_KEY = Deno.env.get("LAZADA_APP_KEY") ?? "";
const APP_SECRET = Deno.env.get("LAZADA_APP_SECRET") ?? "";

function json(obj: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function sign(apiPath: string, params: Record<string, string>, secret: string) {
  const sortedKeys = Object.keys(params).sort();
  let str = apiPath;
  for (const k of sortedKeys) str += k + params[k];
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(str));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, cors);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  let body: any = {};
  try { body = await req.json(); } catch (e) {}
  const code = body.code;
  if (!code) return json({ error: "code is required" }, 400, cors);

  const params: Record<string, string> = {
    app_key: APP_KEY,
    code,
    sign_method: "sha256",
    timestamp: String(Date.now()),
  };
  const signature = await sign("/auth/token/create", params, APP_SECRET);
  const qs = new URLSearchParams({ ...params, sign: signature });

  try {
    const resp = await fetch(`https://auth.lazada.com/rest/auth/token/create?${qs}`);
    const data = await resp.json();
    if (!data.access_token) {
      return json({ ok: false, error: data.code || "lazada_error", message: data.message || "Token exchange failed" }, 502, cors);
    }
    const now = Date.now();
    const expires_in = Number(data.expires_in || 0);
    const refresh_expires_in = Number(data.refresh_expires_in || 0);
    const { error } = await supabase.from("lazada_tokens").upsert(
      {
        id: 1,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: new Date(now + expires_in * 1000).toISOString(),
        refresh_expires_at: new Date(now + refresh_expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) return json({ ok: false, error: error.message }, 500, cors);
    return json({ ok: true, expires_in, refresh_expires_in }, 200, cors);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 502, cors);
  }
});
