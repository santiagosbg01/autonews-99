import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { logger } from './logger.js';

export const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: { persistSession: false },
    db:   { schema: 'public' }
  }
);

/**
 * Upsert a group by its whatsapp_id. If new, pilot_cohort defaults to 'internal'
 * and Santi debe promoverlo manualmente vía onboarding UI si es founder_friend.
 */
export async function upsertGroup({ whatsappId, name }) {
  const { data, error } = await supabase
    .from('groups')
    .upsert(
      {
        whatsapp_id: whatsappId,
        name: name ?? 'unknown',
        is_active: true
      },
      { onConflict: 'whatsapp_id', ignoreDuplicates: false }
    )
    .select('id, pilot_cohort, is_active')
    .single();

  if (error) {
    logger.error({ err: error, whatsappId }, 'Failed to upsert group');
    throw error;
  }
  return data;
}

/**
 * Upsert de participant. Si es primera vez que vemos el teléfono en el grupo,
 * se crea con role='otro' y confirmed_by_santi=false para que Santi lo revise.
 */
export async function upsertParticipant({ groupId, phone, displayName }) {
  const { data, error } = await supabase
    .from('participants')
    .upsert(
      {
        group_id: groupId,
        phone,
        display_name: displayName ?? null,
        last_seen_at: new Date().toISOString()
      },
      { onConflict: 'group_id,phone', ignoreDuplicates: false }
    )
    .select('id, role')
    .single();

  if (error) {
    logger.error({ err: error, groupId, phone }, 'Failed to upsert participant');
    throw error;
  }
  return data;
}

/**
 * Insert de mensaje. Idempotente por whatsapp_msg_id (UNIQUE).
 * Devuelve null si el mensaje ya existía (dedupe).
 */
export async function insertMessage(msg) {
  const { data, error } = await supabase
    .from('messages')
    .insert(msg)
    .select('id')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      logger.debug({ whatsappMsgId: msg.whatsapp_msg_id }, 'Duplicate message, skipping');
      return null;
    }
    logger.error({ err: error, whatsappMsgId: msg.whatsapp_msg_id }, 'Failed to insert message');
    throw error;
  }
  return data;
}

/**
 * Sube un archivo al bucket de Storage (usado para backup de auth_state).
 */
export async function uploadFile(filePath, buffer) {
  const { error } = await supabase.storage
    .from(config.supabase.storageBucket)
    .upload(filePath, buffer, { upsert: true, contentType: 'application/octet-stream' });
  if (error) throw error;
}

export async function downloadFile(filePath) {
  const { data, error } = await supabase.storage
    .from(config.supabase.storageBucket)
    .download(filePath);
  if (error) throw error;
  return data;
}

export async function listFiles(prefix = '') {
  const { data, error } = await supabase.storage
    .from(config.supabase.storageBucket)
    .list(prefix, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) throw error;
  return data;
}
