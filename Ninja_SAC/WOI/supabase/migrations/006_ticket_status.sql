-- ============================================================
-- WOI — Migration 006: Ticket status lifecycle
-- Agrega flujo de estados tipo Zoho Desk a la tabla incidents.
-- ============================================================

-- Estado explícito del ticket
ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS status TEXT
    CHECK (status IN ('abierto','respondido','resuelto','escalado','pendiente'))
    DEFAULT 'abierto';

-- Escalamiento: cuándo y por qué se escaló
ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS escalated_at    TIMESTAMPTZ;
ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS escalated_reason TEXT;   -- 'sin_respuesta_alta_urgencia' | 'manual' | etc.

-- Para mostrar "tiempo abierto" sin calcular: updated_at ya existe
-- Agregar índice para filtrar por estado
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_status_group ON incidents(group_id, status);

-- Backfill: derivar estado para incidentes existentes
UPDATE incidents SET status =
  CASE
    WHEN closed_at IS NOT NULL                                                 THEN 'resuelto'
    WHEN urgency = 'alta'
         AND first_response_at IS NULL
         AND opened_at < NOW() - INTERVAL '45 minutes'                        THEN 'escalado'
    WHEN first_response_at IS NOT NULL
         AND opened_at < NOW() - INTERVAL '4 hours'
         AND closed_at IS NULL                                                 THEN 'pendiente'
    WHEN first_response_at IS NOT NULL AND closed_at IS NULL                  THEN 'respondido'
    ELSE                                                                            'abierto'
  END
WHERE status = 'abierto' OR status IS NULL;

COMMENT ON COLUMN incidents.status
  IS 'abierto|respondido|resuelto|escalado|pendiente — derivado por el reconstructor cada hora';
COMMENT ON COLUMN incidents.escalated_at
  IS 'Timestamp cuando el ticket se escaló (auto o manual)';
COMMENT ON COLUMN incidents.escalated_reason
  IS 'sin_respuesta_alta_urgencia | sin_respuesta_media_urgencia | manual';
