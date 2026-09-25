import { createClient } from "npm:@supabase/supabase-js@2";

function json(obj: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  if (req.method === "GET") {
    const { data: orders, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return json({ error: error.message }, 500, corsHeaders);

    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id,name");
    if (profileError) return json({ error: profileError.message }, 500, corsHeaders);

    const { data: userRows, error: usersError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (usersError) return json({ error: usersError.message }, 500, corsHeaders);

    const nameById = new Map<string, string>((profiles ?? []).map((p) => [p.id, p.name]));
    const emailById = new Map<string, string>((userRows?.users ?? []).map((u) => [u.id, u.email || ""]));
    const enriched = (orders ?? []).map((o) => ({
      ...o,
      customer_name: o.customer_name || nameById.get(o.user_id) || null,
      email: o.email || emailById.get(o.user_id) || "",
    }));
    return json({ orders: enriched }, 200, corsHeaders);
  }

  if (req.method === "POST") {
    let body: any = {};
    try { body = await req.json(); } catch (e) {}
    const { action, order_id } = body;
    if (!order_id) return json({ error: "order_id is required" }, 400, corsHeaders);

    if (action === "decline") {
      const { error } = await supabase.from("orders").update({
        status: "cancelled",
        cancelled_by: "seller",
        cancelled_reason: null,
      }).eq("id", order_id);
      if (error) return json({ error: error.message }, 500, corsHeaders);
      return json({ ok: true }, 200, corsHeaders);
    }

    if (action === "cancel") {
      const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
      const { error } = await supabase.from("orders").update({
        status: "cancelled",
        cancelled_by: "seller",
        cancelled_reason: reason || null,
      }).eq("id", order_id);
      if (error) return json({ error: error.message }, 500, corsHeaders);
      return json({ ok: true }, 200, corsHeaders);
    }

    if (action === "refund") {
      const { error } = await supabase.from("orders").update({
        refunded_at: new Date().toISOString(),
      }).eq("id", order_id);
      if (error) return json({ error: error.message }, 500, corsHeaders);
      return json({ ok: true }, 200, corsHeaders);
    }

    const statusMap: Record<string, string> = {
      accept: "shipped",
      deliver: "delivered",
      finish: "completed",
    };
    const status = statusMap[action];
    if (!status) return json({ error: "invalid action" }, 400, corsHeaders);

    const { error } = await supabase.from("orders").update({ status }).eq("id", order_id);
    if (error) return json({ error: error.message }, 500, corsHeaders);
    return json({ ok: true }, 200, corsHeaders);
  }

  return json({ error: "method not allowed" }, 405, corsHeaders);
});
