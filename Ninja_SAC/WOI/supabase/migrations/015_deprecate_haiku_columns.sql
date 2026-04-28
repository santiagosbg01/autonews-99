-- Migration 015 — Sonnet-only pipeline: deprecar columnas Haiku
-- =============================================================================
-- Decisión (abril 2026): el pipeline pasa a usar exclusivamente Claude Sonnet
-- para clasificación, análisis horario, reconstrucción de incidentes, morning
-- briefing y narrativa diaria. Se elimina el approach Haiku+Sonnet con muestreo
-- ground-truth porque:
--   1. Sonnet tiene mejor accuracy operacional sobre la taxonomía 21x3.
--   2. Mantener un solo modelo simplifica ops, prompts, debugging y costos
--      indirectos (un solo set de few-shots a calibrar, una sola firma de fallo).
--   3. El feedback humano vía `classification_feedback` reemplaza la utilidad
--      del autocomparativo Haiku↔Sonnet.
--
-- Este script NO altera ni borra columnas/datos existentes — sólo marca como
-- deprecadas las columnas y tablas que ya no se llenan, y deja constancia de la
-- decisión en los COMMENTs para futuros operadores.
--
-- Si en el futuro se decide drop físico, hacerlo en una migration separada
-- después de exportar los datos históricos (auditoría / paper trail).
-- =============================================================================

-- analysis.claude_model: ahora siempre contiene un slug Sonnet
COMMENT ON COLUMN analysis.claude_model IS
  'Slug del modelo Claude usado para esta clasificación. Desde abril 2026 el pipeline corre Sonnet-only; valores históricos pueden contener slugs de Haiku 4.5.';

-- ground_truth_samples: tabla deprecada como destino de escritura
COMMENT ON TABLE ground_truth_samples IS
  'DEPRECATED como destino de escritura (V1.1 → Sonnet-only). Conserva muestras del piloto Haiku↔Sonnet para auditabilidad. El pipeline ya no inserta filas nuevas; consultarla solo para análisis históricos.';

COMMENT ON COLUMN ground_truth_samples.haiku_category IS
  'DEPRECATED — categoría producida por Haiku 4.5 durante el piloto inicial. No se actualiza desde abril 2026.';
COMMENT ON COLUMN ground_truth_samples.haiku_bucket IS
  'DEPRECATED — bucket producido por Haiku 4.5 durante el piloto inicial. No se actualiza desde abril 2026.';
COMMENT ON COLUMN ground_truth_samples.haiku_sentiment IS
  'DEPRECATED — sentiment producido por Haiku 4.5 durante el piloto inicial. No se actualiza desde abril 2026.';
COMMENT ON COLUMN ground_truth_samples.match_category IS
  'DEPRECATED — flag generado al comparar haiku_category vs sonnet_category durante el piloto. Sin valor en producción Sonnet-only.';
COMMENT ON COLUMN ground_truth_samples.match_bucket IS
  'DEPRECATED — flag generado al comparar haiku_bucket vs sonnet_bucket durante el piloto. Sin valor en producción Sonnet-only.';
COMMENT ON COLUMN ground_truth_samples.santi_review IS
  'DEPRECATED — antes registraba si Santi prefería la categoría de Haiku o Sonnet. Reemplazado por la tabla classification_feedback (migration 012).';

-- daily_reports.haiku_consistency_pct: ahora siempre NULL en filas nuevas
COMMENT ON COLUMN daily_reports.haiku_consistency_pct IS
  'DEPRECATED — porcentaje de match Haiku↔Sonnet del día durante el piloto. Desde abril 2026 el pipeline es Sonnet-only y esta columna queda en NULL para fechas nuevas. Se conserva para no romper reportes históricos.';
