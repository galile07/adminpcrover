# PCROVER Admin — Technical Reference (Relevant Core Logic)

This document summarizes the key files, runtime flows, data model, and business rules needed to understand and operate the PCROVER admin single-page app.

## 1) Frontend — `js/script.js`

- **Client**: Supabase JS `createClient(SUPABASE_URL, SUPABASE_ANON_KEY)` initialized on load (v2 boot log). Global `sbClient` with `sb(table)` helper.
- **Fetch strategy**: `NETWORK_FIRST_TABLES = ['inventory','imported_products']` with `NET_FIRST_TTL_MS = 60000` (60s TTL). On first load or TTL expiry, network is queried; otherwise localStorage is used. This prevents stale device caches from overwriting server-migrated image URLs.
- **Storage (Supabase Storage)**:
  - Buckets: `productbucket` (public-read), `gcashbucket` (public-read).
  - Helpers: `storagePublicUrl`, `storageUniquePath`, `storageUpload`, `storageUploadImage` (canvas resize to `maxSize` + `quality`, outputs JPEG), `storageUploadDataUrl`, `storageUploadJson`, `storageReadJson`, `storageDelete`.
- **GCash**: local keys `gcashSettings`/`gcashHistory`; remote files `gcashbucket/settings.json`, `gcashbucket/history.json`. `loadGcashRemote()` runs on every page (global) and re-renders GCash UI if present; writes fall back to local-only with toast on failure.
- **Offline/Sync (POS)**: `flushPendingPos()` syncs queued POS sales to Supabase when back online; `updatePosSyncBanner()` toggles banner; SW registered via `registerServiceWorker()`.
- **Price automation (rules)**: `getRules/saveRules/applyRulesToProduct/ruleAdjustedPrice/isRuleAdjusted` — rules stored in `localStorage.priceRules` and mirrored via `syncRulesToBackend()` to `price_rules` table (if present).
- **Notifications**: `refreshNavNotifications()` counts **active** orders (status not `completed/cancelled/declined`) and low-stock items (`stock <= threshold`, enabled). Runs on load (1.6s + 4s) and every 12 min; also called after order actions. 
- **Restock ledger**: `readRestockLedger/saveRestockLedger/processCancelledRestocks(orders)` returns items to inventory/imported_products for cancelled orders once (per `order.id`) using `restockReturnedItems()`.
- **Order helpers (global)**: `toNum`, `parseOrderItems`, `deductStockByName(items)` (case-insensitive match, never below 0; updates `inventory` then `imported_products`, persists via `upsertAll`), `callOrdersFn(action, order_id, extra)` (POST to `admin-orders` function; surfaces server error text from response body), `emailOutcomeSuffix(data)` (maps `{email_sent/email_error}` to toast text/level), `autoAcceptFromOrders(orders)` (accepts `pending` → `shipped` via function; skips stock deduction if `already: true`), `autoAcceptTick()` (polls function GET and auto-accepts; only outside `orders.html`), `autoAcceptPending()` (uses `onlineOrders` list for `orders.html`, 20s interval).
- **Online orders (orders.html)**: `fetchOnlineOrders()` calls `admin-orders` GET, maps rows to UI shape (`pickName`, `orderDateTime`, `parseOrderItems`), caches to `localStorage.onlineOrders`. On page load: fetch + `autoAcceptPending()` + restock + render `shipped`. `__refreshOrders()` (20s interval) does the same. Actions: `deliverOrder` (→ `delivered`, shows email outcome), `finishOrder` (→ `completed`, shows email outcome), `cancelOrder` (→ `cancelled`, stores reasons), `refundOrder` (sets `refunded_at`).
- **Products**: `productImage(product, width)` prefers `product.image`; if empty uses Unsplash keyword fallback by normalized name. `storageUploadImage` shrinks to max 600px/q0.82 on upload; uploads to `productbucket`; on save of products/imported products the UI may attach `_pendingImageFile/_pendingImportImageFile` and writes bucket URL; old image deleted via `storageDelete` when replaced/removed.
- **UI helpers**: `fmtCurrency`, `showToast`, `showConfirm`, `esc`, theme helpers, search/sort in POS/inventory.

## 2) Edge Function — `supabase/functions/admin-orders/index.ts`

- **GET** (no action): returns `{ orders: [...] }` enriched with `customer_name`, `email`, `phone`, `address` from `profiles`/auth where useful; returns raw order fields (`id,user_id,status,payment_method,total,items,created_at,cancel_reason,cancelled_by,cancelled_reason,refunded_at,address,phone,customer_name,email` shape in effect). 
- **Actions (POST)**: `accept`, `deliver`, `finish`, `cancel`, `refund`.
  - `refund`: sets `refunded_at = now()` (by id).
  - Status map: `accept→shipped`, `deliver→delivered`, `finish→completed`. `cancel` → marks `cancelled` and stores `cancel_reason`, `cancelled_by` in updates (as present).
  - Reads full current row (`select("*")`) and **guards transition**: `.update({status}).eq("id",order_id).eq("status", current.status)` to prevent double-updates; returns `already: true` if `current.status === status`.
  - **Emails (automatic)**: only for `deliver` (`type="ready"`) and `finish` (`type="finished"`). Resolves `recipient`: `current.email` → fallback to `supabase.auth.admin.getUserById(current.user_id)` email. If none → returns `{ok:true,email_sent:false,email_error:"no email address"}` and still succeeds. `buildEmail(current, type)` uses `STORE_ADDRESS = "770 Sitio 4 Laot, Bahay Pare, Candaba, 2013 Pampanga"` in the **ready** (delivery/pickup) email body. `sendEmail` posts to `https://api.resend.com/emails` with `RESEND_API_KEY`/`RESEND_FROM`. Email failure is logged and returned as `{ok:true,email_sent:false,email_error:"..."}` (does **not** fail the status update).
- **CORS**: `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: authorization,x-client-info,apikey,content-type`.

## 3) Edge Function — `supabase/functions/auto-accept-orders/index.ts`

- Runs **server-side** with `SUPABASE_SERVICE_ROLE_KEY` (no JWT needed, `--no-verify-jwt`). 
- Selects `orders` where `status='pending'` (limit 50). For each: transition-guarded update `.update({status:'shipped'}).eq("id",id).eq("status",'pending').select("id").maybeSingle()`; on success increments `accepted` and calls `deductStock(parseItems(order.items))`. Returns `{ok, pending_found, accepted, failures}`.
- Stock deduction: reads `inventory` and `imported_products` (id,name,stock), builds in-memory rows, for each item decrements the matching row (case-insensitive, `Math.max(0, stock - qty)`), writes only rows with changed stock back. Mirrors client logic.
- **Scheduled** via Supabase `pg_cron` + `pg_net` every minute (`* * * * *`) calling `https://bpleimrxzigbhpofavec.supabase.co/functions/v1/auto-accept-orders` with empty JSON body. Shared transition guard means UI cron (browser) and server cron never double-deduct stock.
- CORS enabled (safe even without auth).

## 4) Migrations (relevant)

- `20260805_setup_app_tables.sql` — core tables: `inventory`, `imported_products`, `orders`, `transactions` (POS), `price_rules`, `profiles`, `gcash_settings/history`-adjacent scaffolding as present; policies/buckets context implied by app.
- `20260809_lazada_products.sql`, `20260808_lazada_integration.sql` — Lazada integration tables/columns (`lazada_*`, `imported_products.image` populated from Lazada CDN historically; later migrated to `productbucket`).
- `20260810_orders_user_id_nullable.sql` — `orders.user_id` nullable (supports guest/online orders).
- `20260922_orders_cancel_fields.sql` — adds cancellation metadata (`cancel_reason`, `cancelled_by`, `cancelled_reason`).
- `20260922_orders_refunded_at.sql` — adds `refunded_at` timestamp.
- Debug RPC migrations (`20260813_dbg_schema_rpc.sql`, `20260814_dbg_keys_rpc.sql`) exist but were not applied live (noted in AGENTS.md).

## 5) Service Worker — `sw.js` (v5)

- Caches `index.html,dashboard.html,pos.html,orders.html,inventory.html,automation.html,gcash.html` in `STATIC_CACHE = pcrover-offline-v5-static`; navigation cache `NAV_CACHE = pcrover-offline-v5-nav`.
- Activates: deletes old caches except current, calls `clients.claim()`.
- Fetch strategy:
  - `supabase.co` requests: **network-first**, clone and put storage objects (`/storage/v1/object`) into `STATIC_CACHE` on success; fallback to cache on network failure.
  - Navigation requests: network-first with navigation cache update; fallback to cached nav or `index.html`.
  - Other GETs: **cache-first** with background network update into `STATIC_CACHE` on success.

## 6) Pages (high level)

- `index.html` — login (admin/pcrover123), redirects to dashboard.
- `dashboard.html` — KPIs, recent orders, low stock preview.
- `pos.html` — POS cart, qty/cash/pay modals, GCash payment modal, pending sync indicator, offline support hooks.
- `orders.html` — tabs (To Deliver/Shipped? varies by labels), Pick Up/To Finish/Finished/Cancelled, search, order modal/actions (deliver/finish/cancel/refund), 20s auto-refresh + auto-accept.
- `inventory.html` — inventory + imported products tabs, product modal with image field (upload/delete), bulk ops, low-stock filter.
- `gcash.html` — GCash settings form (name/number/QR), Save, History modal; syncs with `gcashbucket`.
- `automation.html` — price automation rules editor.

## 7) Environment/Config

- Supabase: `https://bpleimrxzigbhpofavec.supabase.co` (project ref `bpleimrxzigbhpofavec`). Anon key is public in `js/script.js` (by design). Service-role used only in edge functions (server-side). Secrets: `RESEND_API_KEY`, `RESEND_FROM` set for `admin-orders`; others include Lazada/PayMongo keys (PayMongo functions excluded per request).
- Buckets public-read with anon/authenticated R/W policies applied (documented).
- Deploy: GitHub Pages from `main`; versioned assets (`js/script.js?v=65`, `css/styles.css?v=32`, SW `pcrover-offline-v5`).
- Auth: client-side only (`admin`/`pcrover123`); RLS/anon writes mean anyone with anon key can write until real auth exists (noted).
- Encoding: prefer byte-safe UTF-8 writes (BOM avoided) when editing files in tools.
- Cron: `pg_cron` job `pcrover-auto-accept` every minute calls `auto-accept-orders` via `pg_net` HTTP POST; `--no-verify-jwt` enabled on that function.

## 8) Core Business Rules (summary)

- **Order lifecycle**: `pending` → auto-accepted to `shipped` (browser or server cron). From UI: `deliver`→`delivered`, `finish`→`completed`. Cancellation sets `cancelled` + reasons; refunded sets `refunded_at`.
- **Auto-accept**: happens on orders page load/refresh (20s) and globally (every 45s outside orders, or via 1.6s/4s ticks) and every minute server-side. Transition guard + `already` check prevent double stock deduction.
- **Stock**: deducted on acceptance (`shipped`) only (never on "finished"); returned to stock on cancellation via restock ledger (idempotent by order id).
- **Emails**: sent only for **ready for delivery/pickup** (`deliver`) and **finished** (`finish`); **never** for accept/cancel/decline/refund. Email send failure never blocks status change. Recipient resolved from order/email or auth user + profiles name.
- **Images**: imported products/inventory may store bucket URL in `image`; empty → Unsplash fallback. Uploads resized to 600px JPEG q0.82.
- **GCash**: settings + history sync bidirectionally with bucket JSON; global sync on all pages.
- **Network-first** for `inventory`/`imported_products` (60s TTL) to prefer server truth (migrations).
- **No secrets in HTML/JS**; service-role only server-side. Admin creds client-side (acknowledged).

## 9) Files to know (key)

Relevant (keep):  
- `js/script.js` — all frontend logic (state, actions, storage, auto-accept, notifications)
- `supabase/functions/admin-orders/index.ts` — order mutations + Resend emails
- `supabase/functions/auto-accept-orders/index.ts` — server cron auto-accept + stock
- `supabase/config.toml` — functions config (verify_jwt defaults)
- `sw.js` — offline caching
- HTML pages: `orders.html`, `inventory.html`, `pos.html`, `gcash.html`, `dashboard.html`, `index.html`, `automation.html`
- CSS: `css/styles.css`

Excluded per request: `supabase_schema.sql`, `supabase/functions/paymongo-checkout/index.ts`, `supabase/functions/paymongo-webhook/index.ts`.
