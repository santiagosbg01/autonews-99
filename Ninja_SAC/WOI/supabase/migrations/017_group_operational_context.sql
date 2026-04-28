-- Migration 017 — operational context por grupo
-- =============================================================================
-- Cada grupo tiene su propia operación, vocabulario, SLAs, decision makers e
-- issues activos. Sin ese contexto, Sonnet clasifica mensajes con un baseline
-- genérico y comete errores predecibles:
--   • "se fue a aduana" en cross-border (trámite normal) → marcado como
--     problema_aduana.
--   • "no llegó el manifiesto de las 4am" donde el manifiesto siempre llega
--     5am → marcado como problema_sistema.
--   • "POD listo" donde POD es paso intermedio (no cierre) → cierra tickets
--     antes de tiempo.
--
-- Esta columna es texto libre (markdown opcional). Se inyecta tal cual al final
-- del system prompt en classify_message, generate_group_analysis, ask_is_resolved
-- y generate_morning_briefing. Si está NULL, el pipeline usa solo group_name +
-- country + timezone (comportamiento previo, sin regresión).
--
-- Edición: el dashboard expone un textarea en /grupos/[id]. El campo soporta
-- markdown ligero pero el pipeline lo trata como texto plano para el prompt.
-- =============================================================================

ALTER TABLE groups
  ADD COLUMN operational_context TEXT NULL;

COMMENT ON COLUMN groups.operational_context IS
  'Contexto operacional libre del grupo (markdown opcional, ~2000 chars). Se inyecta en prompts de Sonnet para mejorar clasificación, análisis y briefings. Editable desde /grupos/[id]. NULL = sin contexto explícito.';
