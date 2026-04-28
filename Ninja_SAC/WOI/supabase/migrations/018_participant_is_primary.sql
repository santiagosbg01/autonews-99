-- Migration 018 — agente primario por grupo
-- =============================================================================
-- Agrega `is_primary` a participants. Un agente_99 puede ser PRIMARIO en un
-- grupo (= responsable de SLA, de responder primero, dueño operativo de ese
-- cliente) y secundario o de backup en otros.
--
-- Diseño:
-- * Es un atributo de la relación (group_id, phone) — vive en `participants`,
--   NO en `known_agents`. Una misma persona puede ser primaria en el grupo
--   Amazon y secundaria en el grupo IKEA.
-- * Boolean simple por ahora. Si más adelante se necesitan tiers (primary,
--   backup, KAM, supervisor), se migra a TEXT con CHECK.
-- * Solo aplica cuando role='agente_99'. Para `cliente`/`otro` queda en false.
--   El CHECK lo enforza para evitar cliente marcado como "primario" por error.
--
-- Uso esperado:
-- * Dashboard /grupos/[id] muestra badge "Primario" y toggle.
-- * TTFR/SLA pueden, en futuras iteraciones, exigir que la primera respuesta
--   venga de un agente primario (no de cualquier 99) — por ahora solo es
--   metadata visible.
-- =============================================================================

ALTER TABLE participants
  ADD COLUMN is_primary BOOLEAN NOT NULL DEFAULT FALSE;

-- Solo agente_99 puede ser primario.
ALTER TABLE participants
  ADD CONSTRAINT primary_only_for_agente_99 CHECK (
    is_primary = FALSE OR role = 'agente_99'
  );

-- Index parcial: queries del estilo "agentes primarios del grupo X" son
-- frecuentes (TTFR, alertas, leaderboards). Index pequeño porque solo
-- almacena los rows con is_primary=true.
CREATE INDEX IF NOT EXISTS idx_participants_primary
  ON participants(group_id, phone)
  WHERE is_primary = TRUE;

COMMENT ON COLUMN participants.is_primary IS
  'Marca si este agente_99 es el responsable PRIMARIO del grupo (dueño operativo del SLA del cliente). Solo aplica cuando role=agente_99. Editable desde /grupos/[id]. Default false; un grupo puede tener 0..N primarios.';

-- =============================================================================
-- RPC para auto-promover a agente_99 los phones presentes en >1 grupo.
-- Idempotente: solo toca rows con role IS NULL o role='otro'.
-- Llamada desde el listener al final del sync de participantes.
-- =============================================================================
CREATE OR REPLACE FUNCTION woi_autopromote_agents()
RETURNS TABLE(promoted INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  promoted_count INTEGER;
BEGIN
  WITH multi AS (
    SELECT phone
    FROM participants
    GROUP BY phone
    HAVING COUNT(DISTINCT group_id) > 1
  ),
  upd AS (
    UPDATE participants p
    SET role = 'agente_99', updated_at = NOW()
    FROM multi
    WHERE p.phone = multi.phone
      AND (p.role IS NULL OR p.role = 'otro')
    RETURNING p.id
  )
  SELECT COUNT(*)::INTEGER INTO promoted_count FROM upd;

  RETURN QUERY SELECT promoted_count;
END;
$$;

COMMENT ON FUNCTION woi_autopromote_agents() IS
  'Promueve a role=agente_99 los phones presentes en >1 grupo cuyo role actual sea NULL/otro. Idempotente. Respeta phones ya marcados como cliente. Devuelve cuántas filas actualizó.';
