-- ============================================================
-- WOI — Migration 013: Resolution source + EOD unresolved status
-- ============================================================
-- Mejora la detección de cierre de incidencias:
--  - Nuevo status 'no_resuelto_eod' para tickets cerrados al final del día
--    sin evidencia de resolución (cliente se quejó pero no hubo confirmación).
--  - resolution_source: cómo se cerró el ticket (auditable).
--  - resolution_reason: 1 frase explicando POR QUÉ se considera resuelto
--    (texto generado por Sonnet o constante de heurística).
--
-- Idempotente — todos los cambios usan IF NOT EXISTS / DROP+ADD.
-- ============================================================

-- 1. Permitir el nuevo status 'no_resuelto_eod' en el CHECK constraint.
ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_status_check;
ALTER TABLE incidents
  ADD CONSTRAINT incidents_status_check
  CHECK (status IN (
    'abierto',
    'respondido',
    'resuelto',
    'escalado',
    'pendiente',
    'no_resuelto_eod'
  ));

-- 2. resolution_source — cómo se determinó el cierre.
ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS resolution_source TEXT;

ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_resolution_source_check;
ALTER TABLE incidents
  ADD CONSTRAINT incidents_resolution_source_check
  CHECK (resolution_source IS NULL OR resolution_source IN (
    'agent_signal',        -- Haiku detectó categoría de cierre fuerte/débil de un agente
    'customer_signal',     -- Cliente confirmó resolución explícitamente
    'inactivity',          -- 4h+ de silencio tras respuesta del agente
    'sonnet_thread',       -- Sonnet leyó el hilo y determinó resolución implícita
    'eod_resolved',        -- Job EOD: Sonnet determinó resuelto antes de cerrar el día
    'eod_unresolved',      -- Job EOD: nunca se resolvió en el día → no_resuelto_eod
    'manual'               -- Marcado a mano desde la UI
  ));

-- 3. resolution_reason — 1 frase explicando por qué (Sonnet output o heurística).
ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS resolution_reason TEXT;

-- 4. Índices para queries del dashboard.
CREATE INDEX IF NOT EXISTS idx_incidents_resolution_source
  ON incidents(resolution_source) WHERE resolution_source IS NOT NULL;

-- Para el EOD job: encontrar tickets abiertos hoy en cada timezone.
-- Nota: este índice es funcional sólo para queries que usen el mismo expression.
-- En la práctica el EOD job filtra por opened_at >= start_of_day_local, que
-- ya tiene índice idx_incidents_group_opened.

-- 5. Permitir nuevo source 'auto_eod' en ticket_status_logs.
ALTER TABLE ticket_status_logs DROP CONSTRAINT IF EXISTS ticket_status_logs_source_check;
ALTER TABLE ticket_status_logs
  ADD CONSTRAINT ticket_status_logs_source_check
  CHECK (source IN ('manual','auto','reconstructor','auto_eod'));

-- 6. Comentarios de documentación.
COMMENT ON COLUMN incidents.resolution_source IS
  'Origen del cierre: agent_signal|customer_signal|inactivity|sonnet_thread|eod_resolved|eod_unresolved|manual';
COMMENT ON COLUMN incidents.resolution_reason IS
  'Frase corta (≤200 chars) explicando POR QUÉ se considera resuelto. Útil para auditar y mostrar en UI.';
COMMENT ON CONSTRAINT incidents_status_check ON incidents IS
  '6 estados: abierto|respondido|resuelto|escalado|pendiente|no_resuelto_eod';
