-- Migration 016 — business hours configurables por grupo
-- =============================================================================
-- Cada grupo define su propia ventana laboral (hora inicio, hora fin y días).
-- TTFR (first response) y TTR (resolution) se miden SOLO durante esa ventana.
-- Esto reemplaza la configuración global por env (BUSINESS_HOUR_START/END/DAYS),
-- que ahora sólo actúa como default para grupos nuevos / sin valor explícito.
--
-- Diseño:
-- * `business_hour_start` (0..23): primera hora de la ventana, inclusive.
-- * `business_hour_end`   (1..24): primera hora fuera de la ventana, exclusive.
--   end > start siempre (CHECK).
-- * `business_days` TEXT[]: subset de {mon,tue,wed,thu,fri,sat,sun}.
--   - Default = los 7 días (operación 7×N por hora).
--   - Para sólo lun-vie: ARRAY['mon','tue','wed','thu','fri'].
--   - Para 24/7: start=0, end=24, todos los días.
--
-- Si un grupo no tiene valor (no debería ocurrir por NOT NULL + DEFAULT, pero
-- por defensa), el código (business_hours.py) cae en los env defaults.
-- =============================================================================

ALTER TABLE groups
  ADD COLUMN business_hour_start INTEGER NOT NULL DEFAULT 9,
  ADD COLUMN business_hour_end   INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN business_days       TEXT[]  NOT NULL DEFAULT ARRAY['mon','tue','wed','thu','fri','sat','sun'];

ALTER TABLE groups
  ADD CONSTRAINT business_hour_start_range CHECK (business_hour_start BETWEEN 0 AND 23),
  ADD CONSTRAINT business_hour_end_range   CHECK (business_hour_end   BETWEEN 1 AND 24),
  ADD CONSTRAINT business_hour_window      CHECK (business_hour_end > business_hour_start),
  ADD CONSTRAINT business_days_valid CHECK (
    business_days <@ ARRAY['mon','tue','wed','thu','fri','sat','sun']
    AND array_length(business_days, 1) >= 1
  );

COMMENT ON COLUMN groups.business_hour_start IS
  'Hora local del grupo en que arranca la ventana laboral (0-23, inclusive). Se usa para calcular TTFR/TTR (solo cuenta tiempo dentro de la ventana). Default 9.';
COMMENT ON COLUMN groups.business_hour_end IS
  'Hora local del grupo en que termina la ventana laboral (1-24, exclusive). end > start siempre. Default 20.';
COMMENT ON COLUMN groups.business_days IS
  'Días de la semana en que aplica la ventana laboral (subset de {mon,tue,wed,thu,fri,sat,sun}). Default todos. Tickets fuera de estos días no acumulan TTFR/TTR.';

-- Index para queries de incidentes que ahora cargan estos campos vía JOIN
CREATE INDEX IF NOT EXISTS idx_groups_business_hours ON groups(id)
  INCLUDE (business_hour_start, business_hour_end, business_days);
