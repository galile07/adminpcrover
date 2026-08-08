-- ============================================================
-- PCROVER ADMIN — Lazada integration tables (run once)
-- Run via: supabase db push --linked
-- ============================================================

-- Store the Lazada seller OAuth tokens (edge function uses service role)
CREATE TABLE IF NOT EXISTS lazada_tokens (
  id INT PRIMARY KEY DEFAULT 1,
  access_token TEXT DEFAULT '',
  refresh_token TEXT DEFAULT '',
  expires_at TIMESTAMPTZ,
  refresh_expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE lazada_tokens ENABLE ROW LEVEL SECURITY;

-- Mark which orders came from Lazada so re-syncs never duplicate them
ALTER TABLE orders ADD COLUMN IF NOT EXISTS lazada_order_id TEXT DEFAULT NULL;

-- Track Lazada items so re-syncs update instead of duplicating products
ALTER TABLE imported_products ADD COLUMN IF NOT EXISTS lazada_item_id TEXT DEFAULT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS imported_products_lazada_item_id_idx ON imported_products (lazada_item_id);
