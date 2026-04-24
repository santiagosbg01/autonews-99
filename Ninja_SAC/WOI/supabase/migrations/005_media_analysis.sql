-- ============================================================
-- WOI — Migration 005: Media analysis
-- Descarga y análisis con Claude Vision de imágenes, fotos y documentos
-- de los grupos WhatsApp.
-- ============================================================

-- Agregar columna media_url a messages (URL en Supabase Storage)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;

-- ---------------------------------------------------------------------------
-- media_analysis: resultado de análisis visual con Claude Vision
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_analysis (
  id              BIGSERIAL PRIMARY KEY,
  message_id      BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  group_id        BIGINT NOT NULL REFERENCES groups(id)   ON DELETE CASCADE,
  media_url       TEXT NOT NULL,
  file_path       TEXT,                            -- path en Supabase Storage: {group_id}/{message_id}.jpg
  media_category  TEXT CHECK (media_category IN (
    'evidencia_entrega',   -- Prueba de entrega: fotos de paquetes, firmas, acuses
    'estatus_ruta',        -- Estatus en ruta: GPS, tráfico, condiciones viales
    'foto_vehiculo',       -- Unidad: exterior/interior de camión/van, placas
    'id_conductor',        -- Identificación: INE, licencia, credencial, badge
    'documento',           -- Guía, factura, remisión, orden de compra, label
    'problema_fisico',     -- Incidencia: mercancía dañada, accidente, bloqueo
    'otro'
  )),
  description     TEXT,                            -- 1-2 oraciones de Claude describiendo la imagen
  extracted_text  TEXT,                            -- Texto visible: placas, guías, nombres, direcciones
  confidence      NUMERIC(3,2),                    -- 0.00 – 1.00
  claude_model    TEXT,
  analyzed_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id)
);

CREATE INDEX IF NOT EXISTS idx_media_analysis_group    ON media_analysis(group_id, analyzed_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_analysis_category ON media_analysis(media_category);
CREATE INDEX IF NOT EXISTS idx_media_analysis_msg      ON media_analysis(message_id);

COMMENT ON TABLE  media_analysis                    IS 'Análisis visual Claude Vision de imágenes y documentos';
COMMENT ON COLUMN media_analysis.media_category     IS 'Categoría logística detectada por Claude Vision';
COMMENT ON COLUMN media_analysis.extracted_text     IS 'Texto OCR extraído: placas, números de guía, nombres, etc.';
