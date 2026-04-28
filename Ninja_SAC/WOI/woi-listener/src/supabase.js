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
 * Upsert de participant. Auto-asigna role='agente_99' si el número está en
 * known_agents. Para números desconocidos, deja `role` e `is_primary` sin tocar
 * para preservar lo que ya esté en la fila (clasificación manual o autopromote
 * por presencia en >1 grupo).
 *
 * Reglas:
 * - Si está en known_agents: forzamos role='agente_99' + display_name oficial
 *   + confirmed_by_santi=true (override del usuario).
 * - Si NO está en known_agents y la fila ya existe: solo refrescamos
 *   last_seen_at y opcionalmente display_name (sólo si nos pasaron un valor
 *   no-vacío — null no debe borrar un nombre ya editado).
 * - Si NO está en known_agents y la fila es nueva: insertamos con role='otro'
 *   por default. La auto-promoción a agente_99 (por presencia en >1 grupo)
 *   se aplica posteriormente con `autoPromoteAgents()`.
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

  const payload = {
    group_id:     groupId,
    phone,
    last_seen_at: new Date().toISOString()
  };

  if (knownAgent) {
    // Override autoritativo: la whitelist manda.
    payload.role = 'agente_99';
    payload.display_name = knownAgent.display_name;
    payload.confirmed_by_santi = true;
  } else if (typeof displayName === 'string' && displayName.trim().length > 0) {
    // Solo escribimos display_name cuando viene un valor real — null no debe
    // sobrescribir un nombre ya cargado.
    payload.display_name = displayName.trim();
  }

  // role e is_primary NO se incluyen en el payload cuando no aplican: el
  // upsert hará UPDATE solo de los campos presentes, preservando el resto.

  const { data, error } = await supabase
    .from('participants')
    .upsert(payload, { onConflict: 'group_id,phone', ignoreDuplicates: false })
    .select('id, role, is_primary')
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
 * Promueve a `role='agente_99'` cualquier participante presente en >1 grupo
 * cuyo role actual sea NULL u 'otro'. Útil después del sync de roster.
 *
 * Las personas marcadas manualmente como `cliente` se respetan (no se
 * tocan), porque a veces un mismo KAM del cliente final está en varios chats
 * del mismo cliente y NO es agente nuestro.
 *
 * Returns { promoted: N }.
 */
export async function autoPromoteAgents() {
  const { data, error } = await supabase.rpc('woi_autopromote_agents');
  if (error) {
    // Fallback: si la RPC no existe (viejos entornos sin el helper SQL),
    // ejecutamos el UPDATE inline. Requiere service role key (ya estamos
    // usando ese client).
    logger.warn({ err: error }, 'RPC woi_autopromote_agents not found; running inline UPDATE');
    const { data: rows, error: e2 } = await supabase
      .from('participants')
      .select('phone')
      .or('role.is.null,role.eq.otro');
    if (e2) throw e2;
    // Agrupar por phone y filtrar los con >1 group
    const byPhone = new Map();
    for (const r of rows ?? []) {
      byPhone.set(r.phone, (byPhone.get(r.phone) ?? 0) + 1);
    }
    const targets = [...byPhone.entries()].filter(([, c]) => c > 1).map(([p]) => p);
    if (targets.length === 0) return { promoted: 0 };
    const { count, error: e3 } = await supabase
      .from('participants')
      .update({ role: 'agente_99', updated_at: new Date().toISOString() })
      .in('phone', targets)
      .or('role.is.null,role.eq.otro')
      .select('id', { count: 'exact' });
    if (e3) throw e3;
    return { promoted: count ?? 0 };
  }
  return { promoted: data?.promoted ?? 0 };
}

/**
 * Reconcilia los participantes de un grupo contra una lista canónica de phones
 * (la fuente de verdad: el snapshot fresco de Baileys). Borra todos los rows de
 * `participants` para `groupId` cuyo `phone` NO esté en `keepPhones`.
 *
 * Esto limpia:
 *   - LIDs legacy (cualquier non-E.164 que quedó de versiones previas).
 *   - Gente que ya no está en el grupo (left/kicked).
 *   - Cualquier registro fantasma.
 *
 * Devuelve { deleted: N }.
 *
 * IMPORTANTE: solo llamar después de un upsert exitoso de TODOS los miembros
 * actuales del grupo. Si llamas con `keepPhones=[]` por error vas a borrar
 * todos los participantes.
 */
export async function reconcileGroupParticipants({ groupId, keepPhones }) {
  if (!Array.isArray(keepPhones)) {
    throw new Error('keepPhones must be an array');
  }
  // PostgREST requiere lista no vacía para `.not('phone','in', list)`.
  // Si keepPhones está vacío, eso significa que el grupo realmente está vacío
  // (o sólo somos nosotros y el bot no se cuenta), y queremos borrar todo.
  let query = supabase.from('participants').delete().eq('group_id', groupId);
  if (keepPhones.length > 0) {
    // Construir el filtro `phone=not.in.(p1,p2,...)` manualmente para evitar
    // problemas con phones que tengan caracteres especiales (no debería
    // ocurrir porque ya validamos E.164, pero defensa en profundidad).
    const sanitized = keepPhones
      .filter((p) => /^[0-9]+$/.test(p))
      .map((p) => `"${p}"`)
      .join(',');
    query = query.not('phone', 'in', `(${sanitized})`);
  }
  const { data, error, count } = await query.select('id', { count: 'exact' });
  if (error) {
    logger.error({ err: error, groupId, keep: keepPhones.length }, 'reconcile delete failed');
    throw error;
  }
  return { deleted: count ?? (data?.length ?? 0) };
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
