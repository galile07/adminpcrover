import { createClient } from "npm:@supabase/supabase-js@2";

const APP_KEY = Deno.env.get("LAZADA_APP_KEY") ?? "";
const APP_SECRET = Deno.env.get("LAZADA_APP_SECRET") ?? "";
const API_BASE = "https://api.lazada.com.ph/rest";
const AUTH_BASE = "https://auth.lazada.com/rest";

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

async function lazadaGet(apiPath: string, params: Record<string, string>) {
  const signature = await sign(apiPath, params, APP_SECRET);
  const qs = new URLSearchParams({ ...params, sign: signature });
  const resp = await fetch(`${API_BASE}${apiPath}?${qs}`);
  return resp.json();
}

async function getValidAccessToken(supabase: any) {
  const { data: tok } = await supabase.from("lazada_tokens").select("*").eq("id", 1).single();
  if (!tok?.access_token) return { access_token: null as string | null, refresh_token: null as string | null };
  let access_token = tok.access_token;
  let refresh_token = tok.refresh_token;

  if (!tok.expires_at || new Date(tok.expires_at).getTime() < Date.now() + 5 * 60 * 1000) {
    const params: Record<string, string> = {
      app_key: APP_KEY,
      access_token,
      refresh_token,
      sign_method: "sha256",
      timestamp: String(Date.now()),
    };
    const signature = await sign("/auth/token/refresh", params, APP_SECRET);
    const qs = new URLSearchParams({ ...params, sign: signature });
    const resp = await fetch(`${AUTH_BASE}/auth/token/refresh?${qs}`);
    const d = await resp.json();
    if (d.access_token) {
      access_token = d.access_token;
      refresh_token = d.refresh_token || refresh_token;
      const now = Date.now();
      await supabase.from("lazada_tokens").upsert({
        id: 1,
        access_token,
        refresh_token,
        expires_at: new Date(now + Number(d.expires_in || 0) * 1000).toISOString(),
        refresh_expires_at: new Date(now + Number(d.refresh_expires_in || 0) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
    }
  }
  return { access_token, refresh_token };
}

function imgOf(images: any): string {
  if (!Array.isArray(images) || !images.length) return "";
  const first = images[0];
  return typeof first === "string" ? first : (first && (first.url || first.image_url)) || "";
}

async function syncProducts(supabase: any, access_token: string) {
  let offset = 0;
  let total = null as number | null;
  let upserted = 0;
  for (let page = 0; page < 10; page++) {
    const params: Record<string, string> = {
      app_key: APP_KEY,
      access_token,
      sign_method: "sha256",
      timestamp: String(Date.now()),
      offset: String(offset),
      limit: "100",
    };
    const d = await lazadaGet("/products/get", params);
    if (!d || (d.code && d.code !== "0" && !d.data)) break;
    const data = d.data || {};
    const products = data.products || [];
    if (total === null) total = Number(data.total_products) || 0;
    if (!products.length) break;
    const rows = products.map((p: any) => ({
      lazada_item_id: String(p.item_id),
      name: p.name || p.seller_sku || "Item",
      price: Number(p.price) || 0,
      stock: Number(p.quantity) || 0,
      enabled: String(p.status).toLowerCase() !== "inactive",
      image: imgOf(p.images),
      description: p.short_description || "",
      threshold: 5,
      category: "",
    }));
    const { error } = await supabase.from("imported_products").upsert(rows, { onConflict: "lazada_item_id" });
    if (error) return { error: error.message, upserted };
    upserted += rows.length;
    offset += products.length;
    if (offset >= total) break;
  }
  return { error: null, upserted };
}

function dayStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405, cors);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const { access_token, refresh_token } = await getValidAccessToken(supabase);
  if (!access_token) {
    return json({ ok: false, error: "not_connected", message: "Lazada is not connected yet. Use Connect Lazada first." }, 400, cors);
  }

  const now = new Date();
  const params: Record<string, string> = {
    app_key: APP_KEY,
    access_token,
    sign_method: "sha256",
    timestamp: String(Date.now()),
    created_after: dayStr(new Date(now.getTime() - 7 * 24 * 3600 * 1000)),
    created_before: dayStr(now),
    sort_by: "updated_at",
    sort_direction: "DESC",
    offset: "0",
    limit: "100",
  };

  const data = await lazadaGet("/orders/get", params);
  if (!data || (data.code && data.code !== "0" && !data.data)) {
    return json({ ok: false, error: data.code || "lazada_error", message: data.message || "Failed to fetch orders" }, 502, cors);
  }

  const orders = (data.data && data.data.orders) || [];
  const { data: existing } = await supabase.from("orders").select("lazada_order_id");
  const seen = new Set((existing || []).map((r: any) => r.lazada_order_id));
  let inserted = 0;
  const skipped = [];

  for (const o of orders) {
    const lid = String(o.order_id);
    if (seen.has(lid)) { skipped.push(lid); continue; }
    const addr = o.address_shipping || {};
    const items = (o.items || []).map((i: any) => ({
      name: i.name || i.sku || "Item",
      price: i.item_price,
      value: Number(i.item_price) || 0,
      qty: i.quantity || 1,
    }));
    const total = (Number(o.price) || 0) + (Number(o.shipping_fee) || 0);
    const created_at = Number(o.created_at) ? new Date(Number(o.created_at)).toISOString() : new Date().toISOString();
    const { error } = await supabase.from("orders").insert({
      lazada_order_id: lid,
      customer_name: [o.customer_first_name, o.customer_last_name].filter(Boolean).join(" ").trim() || "Lazada Customer",
      items,
      total,
      payment_method: o.payment_method || "lazada",
      phone: addr.phone || "",
      address: [addr.address1, addr.address2, addr.city].filter(Boolean).join(", "),
      status: "pending",
      created_at,
    });
    if (error) continue;
    seen.add(lid);
    inserted++;
  }

  const prodResult = await syncProducts(supabase, access_token);

  return json({
    ok: true,
    synced: inserted,
    skipped: skipped.length,
    total: orders.length,
    products: prodResult.error ? null : prodResult.upserted,
    products_error: prodResult.error,
    refresh_token_present: Boolean(refresh_token),
  }, 200, cors);
});
