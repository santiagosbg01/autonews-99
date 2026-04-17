-- ============================================================
-- WOI — Migration 001: Initial schema
-- Version: v1.1
-- ============================================================
-- Crea las 7 tablas core del sistema:
--   groups, participants, messages, analysis,
--   ground_truth_samples, incidents, classification_feedback
--
-- Convención:
--   - timestamps en TIMESTAMPTZ
--   - ids BIGSERIAL (puede cambiar a UUID si escalamos)
--   - naming snake_case
-- ============================================================

-- Extensiones ----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- para fuzzy search por nombre de grupo

-- ---------------------------------------------------------------------------
-- groups: catálogo de grupos WhatsApp monitoreados
-- ---------------------------------------------------------------------------
CREATE TABLE groups (
  id              BIGSERIAL PRIMARY KEY,
  whatsapp_id     TEXT UNIQUE NOT NULL,                  -- JID de WhatsApp, ej '1203...@g.us'
  name            TEXT NOT NULL,
  client_hubspot_id TEXT,                                -- Opcional, llenado manual si aplica
  country         TEXT CHECK (country IN ('MX','CO','CL','PE','AR','OTHER')) DEFAULT 'MX',
  timezone        TEXT NOT NULL DEFAULT 'America/Mexico_City',   -- IANA tz, set manual en onboarding
  vertical        TEXT CHECK (vertical IN (
                    'Envios99','Freight99','Tailor99','Fulfill99','Punto99','Cross99','OTHER'
                  )) DEFAULT 'OTHER',
  pilot_cohort    TEXT CHECK (pilot_cohort IN ('internal','founder_friend','external'))
                    DEFAULT 'internal',                  -- Gate legal/operativo
  is_active       BOOLEAN DEFAULT TRUE,
  notes           TEXT,
  joined_at       TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_groups_active      ON groups(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_groups_cohort      ON groups(pilot_cohort);
CREATE INDEX idx_groups_name_trgm   ON groups USING gin (name gin_trgm_ops);

COMMENT ON TABLE  groups                    IS 'Catálogo de grupos WhatsApp monitoreados por el listener';
COMMENT ON COLUMN groups.whatsapp_id        IS 'JID nativo de WhatsApp (termina en @g.us para grupos)';
COMMENT ON COLUMN groups.timezone           IS 'IANA TZ para cálculos de TTFR y business hours';
COMMENT ON COLUMN groups.pilot_cohort       IS 'internal=solo 99; founder_friend=piloto informal; external=requiere Legal formal';

-- ---------------------------------------------------------------------------
-- participants: personas en los grupos con su rol
-- ---------------------------------------------------------------------------
CREATE TABLE participants (
  id                    BIGSERIAL PRIMARY KEY,
  group_id              BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  phone                 TEXT NOT NULL,                   -- E.164 sin '+', ej '5215512345678'
  display_name          TEXT,
  role                  TEXT CHECK (role IN ('cliente','agente_99','otro')) DEFAULT 'otro',
  hubspot_owner_id      TEXT,
  hubspot_contact_id    TEXT,
  confirmed_by_santi    BOOLEAN DEFAULT FALSE,           -- Gate: si Santi ya revisó y confirmó el mapeo
  first_seen_at         TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ DEFAULT NOW(),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, phone)
);

CREATE INDEX idx_participants_role         ON participants(role);
CREATE INDEX idx_participants_confirmed    ON participants(confirmed_by_santi) WHERE confirmed_by_santi = FALSE;
CREATE INDEX idx_participants_phone        ON participants(phone);

COMMENT ON COLUMN participants.role
  IS 'cliente=persona del cliente; agente_99=empleado 99minutos; otro=proveedor externo u otro';

-- ---------------------------------------------------------------------------
-- messages: mensajes crudos (retención indefinida V1 piloto interno)
-- ---------------------------------------------------------------------------
CREATE TABLE messages (
  id                BIGSERIAL PRIMARY KEY,
  whatsapp_msg_id   TEXT UNIQUE NOT NULL,                -- ID nativo Baileys (key.id)
  group_id          BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  sender_phone      TEXT NOT NULL,
  sender_role       TEXT,                                 -- Denormalizado desde participants al momento de insert
  sender_display_name TEXT,                               -- Denormalizado para historical accuracy
  timestamp         TIMESTAMPTZ NOT NULL,                 -- Timestamp del mensaje (no del insert)
  content           TEXT,                                 -- Texto del mensaje; NULL si es solo media
  media_type        TEXT,                                 -- 'image','video','audio','document','sticker', etc.
  media_duration_sec INT,                                 -- Para audio/video
  reply_to_msg_id   TEXT,                                 -- whatsapp_msg_id del mensaje al que responde
  is_forwarded      BOOLEAN DEFAULT FALSE,
  raw_json          JSONB,                                -- Payload completo de Baileys para debugging
  analyzed          BOOLEAN DEFAULT FALSE,
  ingested_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_group_ts       ON messages(group_id, timestamp DESC);
CREATE INDEX idx_messages_analyzed       ON messages(analyzed) WHERE analyzed = FALSE;
CREATE INDEX idx_messages_sender         ON messages(sender_phone, timestamp DESC);
CREATE INDEX idx_messages_timestamp      ON messages(timestamp DESC);

COMMENT ON COLUMN messages.sender_role
  IS 'Denormalizado al momento de ingesta; si participants cambia después, messages preserva el rol histórico';
COMMENT ON COLUMN messages.raw_json
  IS 'Payload Baileys crudo, útil para debugging y recuperación si schema evoluciona';

-- ---------------------------------------------------------------------------
-- incidents: hilos de conversación agrupados (opens → closes)
-- ---------------------------------------------------------------------------
CREATE TABLE incidents (
  id                  BIGSERIAL PRIMARY KEY,
  group_id            BIGINT NOT NULL REFERENCES groups(id),
  opened_at           TIMESTAMPTZ NOT NULL,
  closed_at           TIMESTAMPTZ,
  category            TEXT,                               -- Categoría dominante del hilo
  urgency             TEXT CHECK (urgency IN ('baja','media','alta')),
  first_response_at   TIMESTAMPTZ,
  first_response_by   TEXT,                               -- phone del primer agente_99 que respondió
  resolution_at       TIMESTAMPTZ,
  sentiment_start     NUMERIC(3,2),
  sentiment_end       NUMERIC(3,2),
  sentiment_avg       NUMERIC(3,2),
  owner_phone         TEXT,                               -- Cliente que abrió la incidencia
  summary             TEXT,                               -- Generado por Sonnet al cierre o en el daily
  message_count       INT DEFAULT 0,
  ttfr_seconds        INT,                                -- Opened → first_response
  ttr_seconds         INT,                                -- Opened → resolution
  timezone            TEXT,                               -- Snapshot del TZ del grupo al momento de apertura
  is_open             BOOLEAN GENERATED ALWAYS AS (closed_at IS NULL) STORED,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_incidents_group_opened  ON incidents(group_id, opened_at DESC);
CREATE INDEX idx_incidents_open          ON incidents(is_open) WHERE is_open = TRUE;
CREATE INDEX idx_incidents_category      ON incidents(category);
CREATE INDEX idx_incidents_owner         ON incidents(owner_phone);

COMMENT ON COLUMN incidents.timezone
  IS 'Snapshot del TZ del grupo al momento de apertura, para recalcular SLA si el grupo cambia de TZ';
COMMENT ON COLUMN incidents.ttfr_seconds
  IS 'Time To First Response: segundos desde opened_at hasta first_response_at';

-- ---------------------------------------------------------------------------
-- analysis: resultado de clasificación Claude por mensaje
-- ---------------------------------------------------------------------------
CREATE TABLE analysis (
  message_id          BIGINT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  category            TEXT NOT NULL,                      -- Una de las 21; ver taxonomy table
  bucket              CHAR(1) NOT NULL CHECK (bucket IN ('A','B','C')),
  sentiment           NUMERIC(3,2) CHECK (sentiment BETWEEN -1 AND 1),
  urgency             TEXT CHECK (urgency IN ('baja','media','alta')),
  is_incident_open    BOOLEAN DEFAULT FALSE,
  is_incident_close   BOOLEAN DEFAULT FALSE,
  incident_id         BIGINT REFERENCES incidents(id) ON DELETE SET NULL,
  claude_model        TEXT NOT NULL,                      -- 'claude-haiku-4-5' | 'claude-sonnet-4-5' | etc
  claude_input_tokens INT,
  claude_output_tokens INT,
  claude_cache_read_tokens INT,
  claude_cache_creation_tokens INT,
  claude_raw          JSONB,
  reasoning           TEXT,                               -- Explicación del modelo, max 20 palabras
  analyzed_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analysis_bucket      ON analysis(bucket);
CREATE INDEX idx_analysis_category    ON analysis(category);
CREATE INDEX idx_analysis_incident    ON analysis(incident_id) WHERE incident_id IS NOT NULL;
CREATE INDEX idx_analysis_urgency     ON analysis(urgency) WHERE urgency IN ('media','alta');
CREATE INDEX idx_analysis_model       ON analysis(claude_model);

-- ---------------------------------------------------------------------------
-- taxonomy: catálogo oficial de las 21 categorías (seed data en migration 002)
-- ---------------------------------------------------------------------------
CREATE TABLE taxonomy (
  category       TEXT PRIMARY KEY,
  bucket         CHAR(1) NOT NULL CHECK (bucket IN ('A','B','C')),
  bucket_label   TEXT NOT NULL,
  description_es TEXT NOT NULL,
  sort_order     INT NOT NULL,
  is_active      BOOLEAN DEFAULT TRUE
);

COMMENT ON TABLE taxonomy
  IS 'Catálogo oficial de las 21 categorías en 3 buckets. Source of truth para UI y prompts.';

-- ---------------------------------------------------------------------------
-- ground_truth_samples: muestras clasificadas por Sonnet para medir consistencia
-- ---------------------------------------------------------------------------
CREATE TABLE ground_truth_samples (
  id                  BIGSERIAL PRIMARY KEY,
  message_id          BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  sonnet_category     TEXT NOT NULL,
  sonnet_bucket       CHAR(1) CHECK (sonnet_bucket IN ('A','B','C')),
  sonnet_sentiment    NUMERIC(3,2),
  sonnet_urgency      TEXT,
  sonnet_reasoning    TEXT,
  sonnet_model        TEXT NOT NULL,
  haiku_category      TEXT,
  haiku_bucket        CHAR(1),
  haiku_sentiment     NUMERIC(3,2),
  match_category      BOOLEAN GENERATED ALWAYS AS (haiku_category = sonnet_category) STORED,
  match_bucket        BOOLEAN GENERATED ALWAYS AS (haiku_bucket   = sonnet_bucket)   STORED,
  santi_review        TEXT CHECK (santi_review IN ('agree_sonnet','agree_haiku','disagree_both','unreviewed'))
                        DEFAULT 'unreviewed',
  santi_note          TEXT,
  santi_reviewed_at   TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id)
);

CREATE INDEX idx_gts_match           ON ground_truth_samples(match_category);
CREATE INDEX idx_gts_unreviewed      ON ground_truth_samples(santi_review) WHERE santi_review = 'unreviewed';
CREATE INDEX idx_gts_created         ON ground_truth_samples(created_at DESC);

-- ---------------------------------------------------------------------------
-- classification_feedback: loop de mejora continua (simplificado V1)
-- ---------------------------------------------------------------------------
CREATE TABLE classification_feedback (
  id                  BIGSERIAL PRIMARY KEY,
  message_id          BIGINT REFERENCES messages(id) ON DELETE CASCADE,
  incident_id         BIGINT REFERENCES incidents(id) ON DELETE SET NULL,
  feedback_type       TEXT NOT NULL CHECK (feedback_type IN ('thumbs_up','thumbs_down','recat')),
  suggested_category  TEXT,                               -- Si 'recat', categoría alternativa propuesta
  feedback_note       TEXT,
  reviewer_email      TEXT DEFAULT 'santi@99minutos.com',
  applied_to_few_shot BOOLEAN DEFAULT FALSE,              -- Marcar TRUE cuando el ejemplo entra al prompt
  reviewed_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_feedback_type          ON classification_feedback(feedback_type);
CREATE INDEX idx_feedback_pending_apply ON classification_feedback(applied_to_few_shot) WHERE applied_to_few_shot = FALSE;

-- ---------------------------------------------------------------------------
-- daily_reports: snapshot del reporte diario (log + histórico)
-- ---------------------------------------------------------------------------
CREATE TABLE daily_reports (
  id                      BIGSERIAL PRIMARY KEY,
  report_date             DATE UNIQUE NOT NULL,           -- Fecha CDMX del reporte
  total_messages          INT NOT NULL,
  bucket_a_count          INT NOT NULL,
  bucket_b_count          INT NOT NULL,
  bucket_c_count          INT NOT NULL,
  ratio_b                 NUMERIC(5,4),                   -- Bucket B / (A+B+C)
  incidents_opened        INT DEFAULT 0,
  incidents_closed        INT DEFAULT 0,
  avg_ttfr_seconds        INT,
  avg_ttr_seconds         INT,
  top_incidents_json      JSONB,                          -- Resumen de las top-N incidencias
  agents_red_zone_json    JSONB,                          -- Agentes con TTFR en zona roja
  groups_at_risk_json     JSONB,                          -- Grupos con ratio_b alto
  sonnet_narrative        TEXT,                           -- Resumen ejecutivo generado por Sonnet
  haiku_consistency_pct   NUMERIC(5,2),                   -- Consistencia Haiku↔Sonnet del día
  generated_at            TIMESTAMPTZ DEFAULT NOW(),
  sheet_url               TEXT,                           -- URL del Google Sheet actualizado
  slack_delivered         BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_daily_reports_date ON daily_reports(report_date DESC);

-- ---------------------------------------------------------------------------
-- Triggers de updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_groups_updated       BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_participants_updated BEFORE UPDATE ON participants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_incidents_updated    BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Vistas de conveniencia
-- ---------------------------------------------------------------------------

-- vw_group_daily_health: ratio B diario por grupo (últimos 30 días)
CREATE OR REPLACE VIEW vw_group_daily_health AS
SELECT
  m.group_id,
  g.name                                          AS group_name,
  DATE(m.timestamp AT TIME ZONE g.timezone)       AS day_local,
  COUNT(*) FILTER (WHERE a.bucket = 'A')          AS count_a,
  COUNT(*) FILTER (WHERE a.bucket = 'B')          AS count_b,
  COUNT(*) FILTER (WHERE a.bucket = 'C')          AS count_c,
  COUNT(*)                                        AS total,
  ROUND(
    COUNT(*) FILTER (WHERE a.bucket = 'B')::NUMERIC
    / NULLIF(COUNT(*), 0) * 100, 2
  )                                               AS ratio_b_pct,
  AVG(a.sentiment)                                AS sentiment_avg
FROM messages m
JOIN groups   g ON g.id = m.group_id
JOIN analysis a ON a.message_id = m.id
WHERE m.timestamp >= NOW() - INTERVAL '30 days'
GROUP BY m.group_id, g.name, DATE(m.timestamp AT TIME ZONE g.timezone);

-- vw_agent_leaderboard: performance por agente últimos 7 días
CREATE OR REPLACE VIEW vw_agent_leaderboard AS
SELECT
  i.first_response_by                 AS agent_phone,
  p.display_name                      AS agent_name,
  COUNT(*)                            AS incidents_attended,
  ROUND(AVG(i.ttfr_seconds)::NUMERIC / 60, 2)  AS avg_ttfr_minutes,
  ROUND(AVG(i.ttr_seconds)::NUMERIC / 60, 2)   AS avg_ttr_minutes,
  COUNT(*) FILTER (WHERE i.closed_at IS NOT NULL) AS resolved_count,
  ROUND(
    COUNT(*) FILTER (WHERE i.closed_at IS NOT NULL)::NUMERIC
    / NULLIF(COUNT(*), 0) * 100, 2
  )                                   AS resolution_rate_pct
FROM incidents i
LEFT JOIN participants p
  ON p.phone = i.first_response_by
 AND p.group_id = i.group_id
WHERE i.opened_at >= NOW() - INTERVAL '7 days'
  AND i.first_response_by IS NOT NULL
GROUP BY i.first_response_by, p.display_name
HAVING COUNT(*) >= 1
ORDER BY avg_ttfr_minutes ASC;

-- vw_open_incidents: incidencias abiertas ordenadas por criticidad
CREATE OR REPLACE VIEW vw_open_incidents AS
SELECT
  i.id,
  i.group_id,
  g.name                    AS group_name,
  g.pilot_cohort,
  i.opened_at,
  EXTRACT(EPOCH FROM (NOW() - i.opened_at)) / 3600 AS open_hours,
  i.category,
  i.urgency,
  i.sentiment_avg,
  i.owner_phone,
  i.summary,
  i.message_count,
  i.ttfr_seconds
FROM incidents i
JOIN groups g ON g.id = i.group_id
WHERE i.is_open = TRUE
ORDER BY
  CASE i.urgency WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
  i.opened_at ASC;
