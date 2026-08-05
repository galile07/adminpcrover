-- ============================================================
-- PCROVER ADMIN — Final table fix (policies already exist)
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

-- imported_products: add missing columns
ALTER TABLE imported_products ADD COLUMN IF NOT EXISTS image TEXT DEFAULT '';
ALTER TABLE imported_products ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE imported_products ADD COLUMN IF NOT EXISTS threshold INT DEFAULT 5;

-- pos_orders: recreate with columns the app actually uses
DROP TABLE IF EXISTS pos_orders;
CREATE TABLE pos_orders (
  id BIGSERIAL PRIMARY KEY,
  customer TEXT DEFAULT 'Walk-in Customer',
  type TEXT DEFAULT 'Walk-in',
  amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'Completed',
  date TEXT DEFAULT ''
);

-- auto_rules: recreate with columns the app actually uses
DROP TABLE IF EXISTS auto_rules;
CREATE TABLE auto_rules (
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
