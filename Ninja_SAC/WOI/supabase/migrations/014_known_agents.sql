-- ============================================================
-- WOI — Migration 014: known_agents whitelist
-- ============================================================
-- Tabla de whitelist de números que el listener debe clasificar
-- automáticamente como role='agente_99' al verlos en cualquier grupo.
--
-- Match por sufijo de 10 dígitos (independiente de country code) para
-- tolerar formatos heterogéneos (52..., 56..., 57..., etc.).
-- ============================================================

CREATE TABLE IF NOT EXISTS known_agents (
  phone_suffix  TEXT PRIMARY KEY,                -- últimos 10 dígitos del E.164 sin '+'
  display_name  TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_known_agents_active
  ON known_agents(is_active) WHERE is_active = TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_known_agents_updated'
  ) THEN
    CREATE TRIGGER trg_known_agents_updated
      BEFORE UPDATE ON known_agents
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE  known_agents              IS 'Whitelist global de agentes 99minutos. El listener la consulta por sufijo de 10 dígitos al upsert de cada participante.';
COMMENT ON COLUMN known_agents.phone_suffix IS 'Últimos 10 dígitos del E.164 sin "+". Ej: phone "5215581234567" → suffix "5581234567". Permite match sin importar el country code.';

-- ---------------------------------------------------------------------------
-- Seed inicial — agentes 99 Chile (cohorte piloto)
-- ---------------------------------------------------------------------------
INSERT INTO known_agents (phone_suffix, display_name, notes) VALUES
  ('6932009680', 'Javiera Henríquez',  '99min agent — Chile'),
  ('6996196423', 'Cesar Fierro',       '99min agent — Chile'),
  ('6986699509', 'Daniela Chacón',     '99min agent — Chile'),
  ('6959103627', 'Mayra Morales',      '99min agent — Chile'),
  ('6978476827', 'Nicole Jara',        '99min agent — Chile'),
  ('6933657331', 'Fernanda Pérez',     '99min agent — Chile')
ON CONFLICT (phone_suffix) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  is_active    = TRUE,
  notes        = COALESCE(EXCLUDED.notes, known_agents.notes),
  updated_at   = NOW();

-- ---------------------------------------------------------------------------
-- Backfill: aplicar la whitelist a participants ya cargados
-- ---------------------------------------------------------------------------
UPDATE participants p
SET role               = 'agente_99',
    display_name       = ka.display_name,
    confirmed_by_santi = TRUE
FROM known_agents ka
WHERE RIGHT(p.phone, 10) = ka.phone_suffix
  AND ka.is_active = TRUE
  AND (p.role IS DISTINCT FROM 'agente_99'
       OR p.display_name IS DISTINCT FROM ka.display_name
       OR p.confirmed_by_santi IS DISTINCT FROM TRUE);
