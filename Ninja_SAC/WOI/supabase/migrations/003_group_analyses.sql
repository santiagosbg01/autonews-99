-- ============================================================
-- WOI — Migration 003: Group analyses (hourly Sonnet snapshots)
-- ============================================================

CREATE TABLE IF NOT EXISTS group_analyses (
  id              BIGSERIAL PRIMARY KEY,
  group_id        BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  analyzed_at     TIMESTAMPTZ DEFAULT NOW(),
  window_start    TIMESTAMPTZ NOT NULL,
  window_end      TIMESTAMPTZ NOT NULL,
  message_count   INT NOT NULL DEFAULT 0,
  -- Rich Sonnet narrative
  narrative       TEXT NOT NULL,
  -- Structured JSON insights
  insights        JSONB,          -- { key_topics, anomalies, recommendations }
  participants_summary JSONB,     -- [ { name, role, behavior_summary } ]
  category_counts JSONB,          -- { "problema_horario": 3, "acuse_recibo": 10, ... }
  -- Model metadata
  claude_model    TEXT,
  input_tokens    INT,
  output_tokens   INT
);

CREATE INDEX idx_group_analyses_group_ts ON group_analyses(group_id, analyzed_at DESC);
CREATE INDEX idx_group_analyses_ts       ON group_analyses(analyzed_at DESC);

COMMENT ON TABLE group_analyses
  IS 'Snapshots horarios generados por Sonnet para cada grupo activo';
COMMENT ON COLUMN group_analyses.insights
  IS 'JSON con key_topics (array), anomalies (array), recommendations (array)';
COMMENT ON COLUMN group_analyses.participants_summary
  IS 'Array JSON con resumen de comportamiento por participante';
