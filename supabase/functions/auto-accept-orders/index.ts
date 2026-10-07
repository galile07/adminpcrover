import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Same item shapes the customer site and admin UI produce.
function parseItems(raw: unknown): { name: string; qty: number }[] {
  if (Array.isArray(raw)) {
    return raw.map((i: Record<string, unknown>) => ({
      name: String((i && (i.name || i.item)) || "Item"),
      qty: Number((i && i.qty) || 1) || 1,
    }));
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parseItems(parsed);
    } catch (_) { /* fall through to comma list */ }
    return raw.split(",").map((s) => s.trim()).filter(Boolean)
      .map((name) => ({ name, qty: 1 }));
  }
  return [];
}

// Decrements stock by product name across inventory then imported_products,
// mirroring the admin's deductStockByName exactly (case-insensitive match,
// never below zero). Only rows whose stock actually changed are written.
async function deductStock(items: { name: string; qty: number }[]): Promise<boolean> {
  if (!items.length) return false;
  const invRes = await supabase.from("inventory").select("id,name,stock");
  const impRes = await supabase.from("imported_products").select("id,name,stock");
  if (invRes.error) throw new Error("inventory: " + invRes.error.message);
  if (impRes.error) throw new Error("imported_products: " + impRes.error.message);

  type Row = { table: string; id: number; name: string; stock: number; orig: number };
  const rows: Row[] = [];
  for (const r of invRes.data || []) {
    const stock = Number(r.stock) || 0;
    rows.push({ table: "inventory", id: r.id, name: String(r.name || ""), stock, orig: stock });
  }
  for (const r of impRes.data || []) {
    const stock = Number(r.stock) || 0;
    rows.push({ table: "imported_products", id: r.id, name: String(r.name || ""), stock, orig: stock });
  }

  for (const it of items) {
    const nm = String(it.name || "").trim().toLowerCase();
    if (!nm) continue;
    const hit = rows.find((r) => r.table === "inventory" && r.name.toLowerCase() === nm)
      || rows.find((r) => r.table === "imported_products" && r.name.toLowerCase() === nm);
    if (hit) hit.stock = Math.max(0, hit.stock - (it.qty || 1));
  }

  let changed = false;
  for (const r of rows) {
    if (r.stock === r.orig) continue;
    const { error } = await supabase.from(r.table).update({ stock: r.stock }).eq("id", r.id);
    if (error) console.error(`stock update failed (${r.table} #${r.id}):`, error.message);
    else changed = true;
  }
  return changed;
}

Deno.serve(async () => {
  try {
    const { data: pending, error } = await supabase
      .from("orders")
      .select("id, items")
      .eq("status", "pending")
      .limit(50);
    if (error) return json({ error: error.message }, 500);

    let accepted = 0;
    const failures: string[] = [];
    for (const order of pending || []) {
      // Transition guard: only one runner (cron, dashboard, or an open
      // admin tab) wins the update, so stock is deducted exactly once.
      const { data: updated, error: updErr } = await supabase
        .from("orders")
        .update({ status: "shipped" })
        .eq("id", order.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (updErr) { failures.push(`${order.id}: ${updErr.message}`); continue; }
      if (!updated) continue;
      accepted++;
      try {
        await deductStock(parseItems(order.items));
      } catch (e) {
        failures.push(`${order.id} stock: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return json({ ok: true, pending_found: (pending || []).length, accepted, failures });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
