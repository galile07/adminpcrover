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
  let firstError = null as string | null;

  const { data: existing } = await supabase.from("imported_products").select("*");
  const byLazada = new Map<string, any>();
  const byName = new Map<string, any>();
  (existing || []).forEach((r: any) => {
    if (r.lazada_item_id) byLazada.set(String(r.lazada_item_id), r);
    if (r.name) byName.set(String(r.name).trim().toLowerCase(), r);
  });

  for (let page = 0; page < 10; page++) {
    const params: Record<string, string> = {
      app_key: APP_KEY,
      access_token,
      sign_method: "sha256",
      timestamp: String(Date.now()),
      filter: "all",
      offset: String(offset),
      limit: "20",
    };
    const d = await lazadaGet("/products/get", params);
    if (!d) { if (!firstError) firstError = "Empty products response"; break; }
    if (d.code && d.code !== "0" && !d.data) {
      if (!firstError) firstError = d.message || d.code;
      break;
    }
    const data = d.data || {};
    const products = data.products || [];
    if (total === null) total = Number(data.total_products) || 0;
    if (!products.length) break;

    for (const p of products) {
      const lid = String(p.item_id);
      const attrs = p.attributes || {};
      const sku = (Array.isArray(p.skus) && p.skus[0]) || {};
      const nm = String(p.name || attrs.name || p.seller_sku || sku.SellerSku || ("Lazada Item " + p.item_id)).trim();
      const price = Number(p.price) || Number(sku.price) || 0;
      const stock = Number(p.quantity) || Number(sku.quantity) || Number(sku.Available) || 0;
      const enabled = String(p.status || sku.Status || "active").toLowerCase() !== "inactive";
      const desc = String(p.short_description || attrs.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      let row = lid ? byLazada.get(lid) : undefined;
      if (!row) row = byName.get(nm.toLowerCase());
      if (row) {
        row.lazada_item_id = lid || row.lazada_item_id;
        row.name = nm;
        row.price = price;
        row.stock = stock;
        row.enabled = enabled;
        row.image = imgOf(p.images);
        row.description = desc;
        row.threshold = Number(row.threshold) || 5;
      } else {
        const nr = {
          name: nm,
          price,
          stock,
          enabled,
          image: imgOf(p.images),
          description: desc,
          threshold: 5,
          category: "",
          lazada_item_id: lid || null,
        };
        byName.set(nm.toLowerCase(), nr);
        if (lid) byLazada.set(lid, nr);
      }
      upserted++;
    }
    offset += products.length;
    if (offset >= total) break;
  }

  const matched: any[] = [];
  const toInsert: any[] = [];
  byName.forEach((r: any) => {
    if (r.id !== undefined && r.id !== null) matched.push(r);
    else toInsert.push(r);
  });

  if (matched.length) {
    const { error } = await supabase.from("imported_products").upsert(matched, { onConflict: "id" });
    if (error) return { error: error.message + (error.details ? " " + error.details : ""), upserted: 0 };
  }
  if (toInsert.length) {
    const { error } = await supabase.from("imported_products").insert(toInsert);
    if (error) return { error: error.message + (error.details ? " " + error.details : ""), upserted: 0 };
  }
  return { error: firstError, upserted };
}

function phDateTimeStr(d: Date) {
  const ph = new Date(d.getTime() + 8 * 3600 * 1000);
  return ph.toISOString().slice(0, 19) + "+08:00";
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
    return json({ ok: false, error: "not_connected", message: "Lazada is not connected yet. Click Connect Lazada, authorize the account, then sync again." }, 200, cors);
  }

  const now = new Date();
  const params: Record<string, string> = {
    app_key: APP_KEY,
    access_token,
    sign_method: "sha256",
    timestamp: String(Date.now()),
    created_after: phDateTimeStr(new Date(now.getTime() - 7 * 24 * 3600 * 1000)),
    created_before: phDateTimeStr(now),
    sort_by: "updated_at",
    sort_direction: "DESC",
    offset: "0",
    limit: "100",
  };

  const data = await lazadaGet("/orders/get", params);
  if (!data || (data.code && data.code !== "0" && !data.data)) {
    return json({ ok: false, error: data.code || "lazada_error", message: data.message || "Failed to fetch orders" }, 200, cors);
  }

  const orders = (data.data && data.data.orders) || [];
  const { data: existing } = await supabase.from("orders").select("lazada_order_id");
  const seen = new Set((existing || []).map((r: any) => r.lazada_order_id));
  let inserted = 0;
  const skipped = [];
  let firstInsertError: string | null = null;

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
    if (error) {
      if (!firstInsertError) firstInsertError = error.message;
      continue;
    }
    seen.add(lid);
    inserted++;
  }

  const prodResult = await syncProducts(supabase, access_token);

  await supabase.from("lazada_tokens").update({ last_synced_at: new Date().toISOString() }).eq("id", 1).maybeSingle();

  return json({
    ok: true,
    synced: inserted,
    skipped: skipped.length,
    total: orders.length,
    products: prodResult.error ? null : prodResult.upserted,
    products_error: prodResult.error,
    insert_error: firstInsertError,
    refresh_token_present: Boolean(refresh_token),
  }, 200, cors);
});
