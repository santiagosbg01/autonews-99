-- ============================================================
-- WOI — Migration 002: Taxonomy seed data
-- 21 categorías en 3 buckets (v1.1)
-- ============================================================

INSERT INTO taxonomy (category, bucket, bucket_label, description_es, sort_order) VALUES
  -- Bucket A: Eventos operativos positivos (7)
  ('presentacion_unidad',       'A', 'Eventos operativos positivos', 'Unidad se presenta al punto de origen/destino',                   1),
  ('presentacion_chofer',       'A', 'Eventos operativos positivos', 'Chofer se presenta',                                              2),
  ('presentacion_auxiliar',     'A', 'Eventos operativos positivos', 'Auxiliar se presenta',                                            3),
  ('confirmacion_llegada',      'A', 'Eventos operativos positivos', 'Llegada exitosa a destino/cliente',                               4),
  ('confirmacion_salida',       'A', 'Eventos operativos positivos', 'Salida exitosa del punto/origen',                                 5),
  ('reporte_entrega',           'A', 'Eventos operativos positivos', 'Entrega exitosa al destinatario final',                           6),
  ('confirmacion_evidencias',   'A', 'Eventos operativos positivos', 'Envío/recepción de fotos, firma o POD',                           7),

  -- Bucket B: Incidencias operativas (9)
  ('problema_unidad',           'B', 'Incidencias operativas',       'Issue con la unidad/vehículo (mecánico, disponibilidad)',         8),
  ('problema_horario',           'B', 'Incidencias operativas',       'Horarios/timing: atrasos, reprogramaciones',                      9),
  ('problema_entrada',           'B', 'Incidencias operativas',       'Issue en entrada al punto (CEDIS, cliente, etc.)',               10),
  ('problema_salida',            'B', 'Incidencias operativas',       'Issue en salida de la unidad',                                   11),
  ('problema_trafico',           'B', 'Incidencias operativas',       'Tráfico',                                                        12),
  ('problema_manifestacion',     'B', 'Incidencias operativas',       'Bloqueos, manifestaciones, vías cerradas',                       13),
  ('robo_incidencia',            'B', 'Incidencias operativas',       'Robo o incidencia de seguridad',                                 14),
  ('problema_sistema',           'B', 'Incidencias operativas',       'Plataforma, app, tech, integraciones',                           15),
  ('problema_proveedor',         'B', 'Incidencias operativas',       'Issue con otro proveedor externo',                               16),

  -- Bucket C: Conversacional / meta (5)
  ('acuse_recibo',               'C', 'Conversacional',               'Ack del agente (copiado, enterado) — dispara TTFR sin cerrar',   17),
  ('confirmacion_resolucion',    'C', 'Conversacional',               'Cierre de incidencia (resuelto, listo, recibido conforme)',      18),
  ('consulta_info',              'C', 'Conversacional',               'Pregunta neutral sin queja',                                     19),
  ('saludo_ruido',               'C', 'Conversacional',               'Buenos días, stickers, audios sin contexto, gracias aislado',    20),
  ('otro',                       'C', 'Conversacional',               'Fallback cuando no aplica ninguna categoría',                    21)
ON CONFLICT (category) DO UPDATE SET
  bucket         = EXCLUDED.bucket,
  bucket_label   = EXCLUDED.bucket_label,
  description_es = EXCLUDED.description_es,
  sort_order     = EXCLUDED.sort_order,
  is_active      = TRUE;

-- Constraint para que analysis.category sea una categoría válida del catálogo
ALTER TABLE analysis
  ADD CONSTRAINT fk_analysis_category
  FOREIGN KEY (category) REFERENCES taxonomy(category)
  ON UPDATE CASCADE ON DELETE RESTRICT;
