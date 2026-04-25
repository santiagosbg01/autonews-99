-- ─────────────────────────────────────────────────────────────────────────────
-- 012_classification_feedback.sql
-- Captures human corrections to Sonnet/Haiku classification on incidents and
-- messages so we can:
--   1. Apply the correction immediately (override the field on incidents/analysis)
--   2. Build a labelled training set for prompt/model evaluation
--   3. Track inter-rater agreement on Analytics
--
-- Fed by:
--   - Ticket detail page → "Corregir clasificación" form (server action)
--   - Future: bulk re-labeling tools, agent-side feedback UI
--
-- Note: 001_initial_schema.sql created an early stub (`feedback_type` /
-- `suggested_category`) that was never wired up. We drop it here and replace
-- with a more general field-level audit log.
-- ─────────────────────────────────────────────────────────────────────────────

-- Replace the legacy stub if present (safe: it was never written to).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'classification_feedback' AND column_name = 'feedback_type'
  ) THEN
    DROP TABLE classification_feedback CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS classification_feedback (
  id              BIGSERIAL PRIMARY KEY,

  -- One of these must be set; both can co-exist if a per-message correction
  -- was applied via an incident form.
  incident_id     BIGINT REFERENCES incidents(id) ON DELETE SET NULL,
  message_id      BIGINT REFERENCES messages(id)  ON DELETE SET NULL,

  -- Which field was corrected. 'category' | 'urgency' | 'sentiment' | 'bucket'
  -- | 'summary' | 'other'
  field           TEXT NOT NULL CHECK (
    field IN ('category','urgency','sentiment','bucket','summary','other')
  ),
  old_value       TEXT,                       -- value before override (string-cast)
  new_value       TEXT,                       -- value after override (string-cast)

  reason          TEXT,                       -- optional free-text explanation
  submitted_by    TEXT NOT NULL DEFAULT 'dashboard',
  source          TEXT NOT NULL DEFAULT 'dashboard',  -- 'dashboard' | 'cli' | 'api'
  applied         BOOLEAN NOT NULL DEFAULT TRUE,      -- whether the override hit the source row

  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT classification_feedback_target
    CHECK (incident_id IS NOT NULL OR message_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_clf_feedback_incident
  ON classification_feedback (incident_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_clf_feedback_message
  ON classification_feedback (message_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_clf_feedback_recent
  ON classification_feedback (submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_clf_feedback_field
  ON classification_feedback (field, submitted_at DESC);

COMMENT ON TABLE  classification_feedback
  IS 'Human-in-the-loop corrections to Sonnet/Haiku classification. Audit + training data.';
COMMENT ON COLUMN classification_feedback.applied
  IS 'TRUE if the source row (incidents / analysis) was updated; FALSE if the feedback was logged but not yet applied (e.g. message_id had no analysis row).';
