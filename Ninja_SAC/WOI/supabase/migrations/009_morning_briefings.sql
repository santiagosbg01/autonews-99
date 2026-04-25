-- ─────────────────────────────────────────────────────────────────────────────
-- 009_morning_briefings.sql
-- Daily morning briefing for supervisors: structured summary of yesterday's
-- activity with long-term trend context.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS morning_briefings (
  id              SERIAL PRIMARY KEY,
  briefing_date   DATE NOT NULL UNIQUE,           -- the day the briefing covers
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- High-level numbers (so the dashboard can render KPI cards without
  -- re-aggregating)
  total_messages       INT,
  total_incidents      INT,
  incidents_resolved   INT,
  incidents_escalated  INT,
  avg_ttfr_seconds     INT,
  avg_sentiment        NUMERIC(4,3),  -- -1..1

  -- Headline written by Sonnet (1-2 sentences for the dashboard card)
  headline TEXT,

  -- Full structured briefing (Sonnet output as JSON)
  -- Schema:
  --   {
  --     "headline": "...",
  --     "highlights": [
  --       {"title": "...", "detail": "...", "severity": "info|warning|critical"}
  --     ],
  --     "incidents_summary": [
  --       {"group": "...", "category": "...", "count": N, "trend": "primera_vez|recurrente|frecuente", "note": "..."}
  --     ],
  --     "groups_to_watch": [
  --       {"group": "...", "reason": "...", "severity": "info|warning|critical"}
  --     ],
  --     "trend_note": "...",   // 2-3 sentences about week/month trend
  --     "churn_signals": [     // any aggressive client language
  --       {"group": "...", "quote": "...", "context": "..."}
  --     ],
  --     "agents_red_zone": [
  --       {"agent": "...", "ttfr_avg_min": N, "incidents": N}
  --     ]
  --   }
  briefing_json JSONB NOT NULL,

  -- Markdown version for quick rendering / copy-paste
  briefing_markdown TEXT,

  claude_model     TEXT,
  input_tokens     INT,
  output_tokens    INT
);

CREATE INDEX IF NOT EXISTS morning_briefings_date_idx
  ON morning_briefings (briefing_date DESC);

COMMENT ON TABLE morning_briefings IS
  'Daily structured morning briefing for ops supervisors. One row per calendar day (CDMX).';
