import { createClient } from "npm:@supabase/supabase-js@2";

const STORE_ADDRESS = "770 Sitio 4 Laot, Bahay Pare, Candaba, 2013 Pampanga";

function json(obj: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM");
  if (!apiKey) throw new Error("RESEND_API_KEY not configured");
  if (!from) throw new Error("RESEND_FROM not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  const body: Record<string, unknown> = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof body.message === "string" ? body.message : `Resend returned HTTP ${res.status}`;
    throw new Error(msg);
  }
}

function buildEmail(order: { id: string; payment_method?: string | null; customer_name?: string | null }, type: string) {
  const code = String(order.id || "").toUpperCase().slice(0, 8);
  const greeting = "Hello " + String(order.customer_name || "there") + ",\n\n";
  if (type === "ready") {
    let text = greeting + 'Your order no. "' + code + '" is now ready for delivery.\n';
    if (String(order.payment_method || "").toLowerCase() === "pickup") {
      text += "Go to our physical store " + STORE_ADDRESS + " to claim your item.\n";
    }
    return {
      subject: "PC Rover – Your order #" + code + " is ready for delivery",
      text: text + "\n-PC Rover team",
    };
  }
  if (type === "finished") {
    return {
      subject: "PC Rover – Your order #" + code + " is complete",
      text: greeting + 'Your order no. "' + code + '" is complete. Thank you for choosing PC Rover!\n\n-PC Rover team',
    };
  }
  return null;
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

    const { data: current, error: readError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", order_id)
      .maybeSingle();
    if (readError) return json({ error: readError.message }, 500, corsHeaders);
    if (!current) return json({ error: "order not found" }, 404, corsHeaders);

    // Already in the target state: nothing to change and no email to send.
    if (current.status === status) return json({ ok: true, already: true }, 200, corsHeaders);

    const { data: updated, error } = await supabase
      .from("orders")
      .update({ status })
      .eq("id", order_id)
      .eq("status", current.status)
      .select("id")
      .maybeSingle();
    if (error) return json({ error: error.message }, 500, corsHeaders);
    if (!updated) return json({ error: "order changed at the same time, please retry" }, 409, corsHeaders);

    // Automatic customer emails: only for "ready" (deliver/pickup) and "finished".
    const emailType = action === "deliver" ? "ready" : action === "finish" ? "finished" : "";
    if (!emailType) return json({ ok: true }, 200, corsHeaders);

    let recipient = String(current.email || "").trim();
    if (!recipient && current.user_id) {
      const { data: authUser } = await supabase.auth.admin.getUserById(current.user_id);
      recipient = String(authUser?.user?.email || "").trim();
    }
    if (!recipient) {
      return json({ ok: true, email_sent: false, email_error: "no email address" }, 200, corsHeaders);
    }

    if (!current.customer_name && current.user_id) {
      const { data: profile } = await supabase.from("profiles").select("name").eq("id", current.user_id).maybeSingle();
      current.customer_name = profile?.name || null;
    }

    const mail = buildEmail(current, emailType);
    if (!mail) return json({ ok: true }, 200, corsHeaders);

    try {
      await sendEmail(recipient, mail.subject, mail.text);
      return json({ ok: true, email_sent: true }, 200, corsHeaders);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("email send failed:", msg);
      return json({ ok: true, email_sent: false, email_error: msg }, 200, corsHeaders);
    }
  }

  return json({ error: "method not allowed" }, 405, corsHeaders);
});
