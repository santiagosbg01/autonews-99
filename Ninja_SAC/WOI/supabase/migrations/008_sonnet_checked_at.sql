-- Migration 008: columna para rastrear cuándo Sonnet revisó si un ticket está resuelto
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS sonnet_checked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_incidents_sonnet_checked ON incidents(sonnet_checked_at) WHERE closed_at IS NULL;
