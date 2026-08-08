-- ============================================================
-- PCROVER ADMIN — Lazada product sync support (run once)
-- Run via: supabase db push --linked
-- ============================================================

-- Track Lazada items so re-syncs update instead of duplicating products
ALTER TABLE imported_products ADD COLUMN IF NOT EXISTS lazada_item_id TEXT DEFAULT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS imported_products_lazada_item_id_idx ON imported_products (lazada_item_id);
