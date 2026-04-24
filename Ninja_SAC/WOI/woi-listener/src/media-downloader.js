/**
 * Descarga medios de WhatsApp (imágenes y documentos) y los sube a Supabase Storage.
 * Solo se procesan tipos descargables: image, document (PDF/common formats).
 * Videos y audios se omiten por tamaño.
 */
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { supabase } from './supabase.js';
import { logger } from './logger.js';

const MEDIA_BUCKET = 'woi-media';

// Extensiones de documentos permitidos (evitar binarios grandes)
const ALLOWED_DOC_EXTS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'doc', 'docx', 'xls', 'xlsx', 'csv']);

/**
 * Garantiza que el bucket woi-media exista. Llamar una vez al inicio.
 */
export async function ensureMediaBucket() {
  try {
    await supabase.storage.createBucket(MEDIA_BUCKET, {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024   // 10 MB
    });
    logger.info({ bucket: MEDIA_BUCKET }, 'Media bucket created');
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (msg.includes('already exists') || msg.includes('Duplicate')) {
      logger.debug({ bucket: MEDIA_BUCKET }, 'Media bucket already exists');
    } else {
      logger.warn({ err, bucket: MEDIA_BUCKET }, 'Media bucket check failed (non-fatal)');
    }
  }
}

/**
 * Determina si este mensaje tiene media descargable.
 * Retorna { ext, mimeType } o null si no aplica.
 */
function getMediaMeta(msgContent) {
  if (!msgContent) return null;

  if (msgContent.imageMessage) {
    return { ext: 'jpg', mimeType: 'image/jpeg' };
  }

  if (msgContent.documentMessage) {
    const fn   = msgContent.documentMessage.fileName ?? 'doc.pdf';
    const ext  = fn.includes('.') ? fn.split('.').pop().toLowerCase() : 'pdf';
    const mime = msgContent.documentMessage.mimetype ?? 'application/pdf';
    if (!ALLOWED_DOC_EXTS.has(ext)) return null;
    return { ext, mimeType: mime };
  }

  // Videos, audios, stickers → ignorar
  return null;
}

/**
 * Descarga la media de WhatsApp y la sube a Supabase Storage.
 *
 * @param {object} msg         Mensaje completo de Baileys (con key + message)
 * @param {object} sock        Socket activo de Baileys (para re-upload si expiró)
 * @param {number} groupId     ID de grupo en nuestra DB
 * @param {number} messageId   ID de mensaje en nuestra DB
 * @returns {string|null}      URL pública en Supabase Storage, o null si falló
 */
export async function downloadAndStoreMedia(msg, sock, groupId, messageId) {
  const meta = getMediaMeta(msg.message);
  if (!meta) return null;

  try {
    const buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger, reuploadRequest: sock.updateMediaMessage }
    );

    if (!buffer || buffer.length === 0) {
      logger.debug({ messageId }, 'Empty media buffer, skipping');
      return null;
    }

    const filePath = `${groupId}/${messageId}.${meta.ext}`;

    const { error: uploadErr } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(filePath, buffer, { contentType: meta.mimeType, upsert: true });

    if (uploadErr) {
      logger.warn({ err: uploadErr, filePath }, 'Storage upload failed');
      return null;
    }

    const { data: { publicUrl } } = supabase.storage
      .from(MEDIA_BUCKET)
      .getPublicUrl(filePath);

    logger.info(
      { groupId, messageId, filePath, sizeKb: Math.round(buffer.length / 1024) },
      'Media stored in Supabase Storage'
    );
    return publicUrl;

  } catch (err) {
    logger.warn({ err, messageId }, 'Media download/upload failed (non-fatal)');
    return null;
  }
}
