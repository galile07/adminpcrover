-- ============================================================
-- PCROVER ADMIN — idempotent schema fix (safe to re-run)
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Missing columns (no-op if already present)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT DEFAULT '';
ALTER TABLE imported_products ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '';

-- 2. Tables with the exact columns the app uses
CREATE TABLE IF NOT EXISTS pos_orders (
  id BIGSERIAL PRIMARY KEY,
  customer TEXT DEFAULT 'Walk-in Customer',
  type TEXT DEFAULT 'Walk-in',
  amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'Completed',
  date TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS auto_rules (
  id BIGSERIAL PRIMARY KEY,
  name TEXT DEFAULT '',
  direction TEXT DEFAULT 'add',
  field TEXT DEFAULT 'stock',
  operator TEXT DEFAULT 'greater',
  value NUMERIC DEFAULT 0,
  adjustvalue NUMERIC DEFAULT 0,
  adjusttype TEXT DEFAULT 'percent',
  enabled BOOLEAN DEFAULT true
);

-- 3. RLS policies (drop + recreate so they always exist)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['imported_products','inventory','pos_orders','auto_rules'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "anon all %I" ON %I', t, t);
    EXECUTE format('CREATE POLICY "anon all %I" ON %I FOR ALL USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;
