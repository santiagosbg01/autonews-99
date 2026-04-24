-- ============================================================
-- WOI — Migration 007: Audit log de cambios de estado en tickets
-- ============================================================

CREATE TABLE IF NOT EXISTS ticket_status_logs (
  id            BIGSERIAL PRIMARY KEY,
  incident_id   BIGINT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  changed_at    TIMESTAMPTZ DEFAULT NOW(),
  changed_by    TEXT NOT NULL DEFAULT 'system',   -- nombre del operador o 'system' / 'reconstructor'
  from_status   TEXT,                              -- null si es la primera entrada
  to_status     TEXT NOT NULL,
  reason        TEXT,                              -- nota opcional del operador
  source        TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'auto', 'reconstructor'))
);

CREATE INDEX IF NOT EXISTS idx_ticket_logs_incident ON ticket_status_logs(incident_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_logs_changed_by ON ticket_status_logs(changed_by);

COMMENT ON TABLE  ticket_status_logs           IS 'Historial inmutable de todos los cambios de estado de tickets';
COMMENT ON COLUMN ticket_status_logs.changed_by IS 'Nombre del operador (manual) o sistema (auto/reconstructor)';
COMMENT ON COLUMN ticket_status_logs.source     IS 'manual=operador en dashboard; auto=SLA automático; reconstructor=proceso horario';

-- Backfill: crear entrada de apertura para todos los incidentes existentes
INSERT INTO ticket_status_logs (incident_id, changed_at, changed_by, from_status, to_status, source)
SELECT id, opened_at, 'system', NULL, 'abierto', 'reconstructor'
FROM incidents
ON CONFLICT DO NOTHING;

-- Backfill: registrar estado actual para los que ya no están en 'abierto'
INSERT INTO ticket_status_logs (incident_id, changed_at, changed_by, from_status, to_status, source)
SELECT id, updated_at, 'system', 'abierto', status, 'auto'
FROM incidents
WHERE status != 'abierto'
ON CONFLICT DO NOTHING;
