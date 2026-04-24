-- ============================================================
-- WOI — Migration 004: Daily KPI snapshots per group
-- ============================================================

CREATE TABLE IF NOT EXISTS group_kpi_snapshots (
  id                    BIGSERIAL PRIMARY KEY,
  group_id              BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  snapshot_date         DATE NOT NULL,

  -- Sentiment
  client_sentiment_avg  NUMERIC(4,3),   -- average of analyzed client messages
  overall_sentiment_avg NUMERIC(4,3),   -- all roles

  -- Message volume
  total_messages        INT NOT NULL DEFAULT 0,
  bucket_a              INT NOT NULL DEFAULT 0,
  bucket_b              INT NOT NULL DEFAULT 0,
  bucket_c              INT NOT NULL DEFAULT 0,
  ratio_b               NUMERIC(5,4),

  -- Incident KPIs
  incidents_opened      INT NOT NULL DEFAULT 0,
  incidents_closed      INT NOT NULL DEFAULT 0,
  avg_ttfr_seconds      INT,            -- avg time-to-first-response
  avg_ttr_seconds       INT,            -- avg time-to-resolution
  p90_ttfr_seconds      INT,            -- 90th percentile TTFR

  -- Risk
  risk_level            TEXT CHECK (risk_level IN ('alto','medio','bajo')),
  anomaly_count         INT DEFAULT 0,

  created_at            TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(group_id, snapshot_date)
);

CREATE INDEX idx_kpi_snapshots_group_date ON group_kpi_snapshots(group_id, snapshot_date DESC);
CREATE INDEX idx_kpi_snapshots_date       ON group_kpi_snapshots(snapshot_date DESC);

COMMENT ON TABLE group_kpi_snapshots
  IS 'Snapshot diario de KPIs por grupo: sentiment, volumen, TTFR, TTR';
