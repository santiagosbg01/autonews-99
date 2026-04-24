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
 * Upsert de participant. Auto-asigna role='agente_99' si el número está en known_agents.
 * Para números desconocidos, crea con role='otro' y deja confirmed_by_santi=false.
 */
export async function upsertParticipant({ groupId, phone, displayName }) {
  // Buscar en known_agents por sufijo de 10 dígitos
  const suffix = phone.slice(-10);
  const { data: knownAgent } = await supabase
    .from('known_agents')
    .select('display_name')
    .eq('phone_suffix', suffix)
    .eq('is_active', true)
    .maybeSingle();

  const upsertData = {
    group_id:     groupId,
    phone,
    last_seen_at: new Date().toISOString(),
    ...(knownAgent
      ? { role: 'agente_99', display_name: knownAgent.display_name, confirmed_by_santi: true }
      : { display_name: displayName ?? null }
    )
  };

  const { data, error } = await supabase
    .from('participants')
    .upsert(upsertData, { onConflict: 'group_id,phone', ignoreDuplicates: false })
    .select('id, role')
    .single();

  if (error) {
    logger.error({ err: error, groupId, phone }, 'Failed to upsert participant');
    throw error;
  }

  if (knownAgent) {
    logger.debug({ phone, name: knownAgent.display_name }, 'Auto-assigned agente_99');
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

/**
 * Actualiza media_url en un mensaje ya insertado.
 */
export async function updateMessageMediaUrl(messageId, mediaUrl) {
  const { error } = await supabase
    .from('messages')
    .update({ media_url: mediaUrl })
    .eq('id', messageId);
  if (error) logger.warn({ err: error, messageId }, 'Failed to update media_url');
}

export async function listFiles(prefix = '') {
  const { data, error } = await supabase.storage
    .from(config.supabase.storageBucket)
    .list(prefix, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) throw error;
  return data;
}
