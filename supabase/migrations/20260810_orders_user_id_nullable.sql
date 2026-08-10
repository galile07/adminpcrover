-- Lazada orders don't come from a customer account, so user_id must be optional
ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL;
