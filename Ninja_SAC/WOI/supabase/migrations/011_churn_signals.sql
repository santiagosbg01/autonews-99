-- ─────────────────────────────────────────────────────────────────────────────
-- 011_churn_signals.sql
-- Persists per-message churn-risk signals (aggressive language, threats to leave,
-- explicit complaints) so they can be surfaced as alerts across the dashboard.
--
-- Fed by:
--   1. churn_detector.py  — deterministic keyword scan, runs on each hourly tick
--   2. morning_briefing   — Sonnet's nuanced detection, persists into this table
--   3. manual flag        — agent-friendly UI to mark/unmark a signal
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS churn_signals (
  id              SERIAL PRIMARY KEY,
  group_id        INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  message_id      INT REFERENCES messages(id)  ON DELETE SET NULL,
  incident_id     INT REFERENCES incidents(id) ON DELETE SET NULL,

  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 'threat_to_leave' (highest), 'aggressive_language', 'service_complaint'
  severity        TEXT NOT NULL,
  confidence      NUMERIC(4,3),  -- 0..1, how strong is the signal
  source          TEXT NOT NULL, -- 'keyword' | 'morning_briefing' | 'manual'

  quote           TEXT NOT NULL,
  context         TEXT,
  matched_keyword TEXT,          -- only for source='keyword'

  sender_phone        TEXT,
  sender_display_name TEXT,
  sender_role         TEXT,

  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT,
  resolution_note TEXT
);

-- Idempotency:
--   - keyword scans dedupe by (message_id, severity, source) since they
--     always have a message_id
--   - briefing-sourced rows can have NULL message_id, so we also key on a
--     hash of the quote (first 240 chars) to avoid collapsing distinct quotes
CREATE UNIQUE INDEX IF NOT EXISTS churn_signals_uniq
  ON churn_signals (
    COALESCE(message_id, 0),
    severity,
    source,
    md5(LEFT(quote, 240))
  );

CREATE INDEX IF NOT EXISTS churn_signals_group_open_idx
  ON churn_signals (group_id, resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS churn_signals_detected_at_idx
  ON churn_signals (detected_at DESC);
CREATE INDEX IF NOT EXISTS churn_signals_incident_idx
  ON churn_signals (incident_id);

COMMENT ON TABLE churn_signals IS
  'Per-message churn-risk signals (aggressive language, threats, complaints). Open = resolved_at IS NULL.';
COMMENT ON COLUMN churn_signals.severity IS
  'threat_to_leave > aggressive_language > service_complaint.';
