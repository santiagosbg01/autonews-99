-- ─────────────────────────────────────────────────────────────────────────────
-- 010_morning_briefings_per_group.sql
-- Convert morning briefings from global → per-group, scheduled at 6 am local.
-- Each group gets its own briefing per day at 6 am in its own timezone.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE morning_briefings
  ADD COLUMN IF NOT EXISTS group_id INT REFERENCES groups(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS timezone TEXT;

-- Drop the old (briefing_date) UNIQUE so we can have one per (date, group)
ALTER TABLE morning_briefings
  DROP CONSTRAINT IF EXISTS morning_briefings_briefing_date_key;

-- New unique: one briefing per group per date.
-- Legacy global briefings (where group_id is NULL) treat as a single "global"
-- per date by coalescing to 0.
CREATE UNIQUE INDEX IF NOT EXISTS morning_briefings_date_group_uq
  ON morning_briefings (briefing_date, COALESCE(group_id, 0));

CREATE INDEX IF NOT EXISTS morning_briefings_group_date_idx
  ON morning_briefings (group_id, briefing_date DESC);

COMMENT ON COLUMN morning_briefings.group_id IS
  'NULL = legacy global briefing; non-NULL = per-group briefing in that group local timezone.';
COMMENT ON COLUMN morning_briefings.timezone IS
  'Timezone the briefing was generated for (e.g. America/Mexico_City, America/Lima).';
