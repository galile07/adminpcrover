-- Track when the last successful Lazada sync ran (for the Sync Settings UI)
ALTER TABLE lazada_tokens ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ DEFAULT NULL;
