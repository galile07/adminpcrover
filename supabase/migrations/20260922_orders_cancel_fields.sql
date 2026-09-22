-- ============================================================
-- PCROVER ADMIN — cancelled orders metadata (idempotent)
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_reason TEXT DEFAULT NULL;