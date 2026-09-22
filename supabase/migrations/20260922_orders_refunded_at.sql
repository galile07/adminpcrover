-- ============================================================
-- PCROVER ADMIN — refunded orders flag (idempotent)
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ DEFAULT NULL;