import { logger } from './logger.js';
import { upsertGroup, upsertParticipant, insertMessage, updateMessageMediaUrl } from './supabase.js';
import { markHealthy } from './healthcheck.js';
import { downloadAndStoreMedia } from './media-downloader.js';

/**
 * Extrae tipo de media y contenido legible desde un message de Baileys.
 */
function extractContent(message) {
  if (!message) return { content: null, mediaType: null, mediaDurationSec: null };

  if (message.conversation) {
    return { content: message.conversation, mediaType: null, mediaDurationSec: null };
  }
  if (message.extendedTextMessage?.text) {
    return { content: message.extendedTextMessage.text, mediaType: null, mediaDurationSec: null };
  }
  if (message.imageMessage) {
    return {
      content: message.imageMessage.caption ?? null,
      mediaType: 'image',
      mediaDurationSec: null
    };
  }
  if (message.videoMessage) {
    return {
      content: message.videoMessage.caption ?? null,
      mediaType: 'video',
      mediaDurationSec: message.videoMessage.seconds ?? null
    };
  }
  if (message.audioMessage) {
    return {
      content: null,
      mediaType: message.audioMessage.ptt ? 'voice_note' : 'audio',
      mediaDurationSec: message.audioMessage.seconds ?? null
    };
  }
  if (message.documentMessage) {
    return {
      content: message.documentMessage.fileName ?? null,
      mediaType: 'document',
      mediaDurationSec: null
    };
  }
  if (message.stickerMessage) {
    return { content: null, mediaType: 'sticker', mediaDurationSec: null };
  }
  if (message.locationMessage) {
    return { content: '[location]', mediaType: 'location', mediaDurationSec: null };
  }
  if (message.contactMessage) {
    return { content: '[contact]', mediaType: 'contact', mediaDurationSec: null };
  }
  if (message.reactionMessage) {
    // Emoji reaction to a specific message — store emoji as content, target msg id as reply_to
    return {
      content: message.reactionMessage.text || null,
      mediaType: 'reaction',
      mediaDurationSec: null,
      reactionTargetId: message.reactionMessage.key?.id ?? null,
    };
  }
  return { content: null, mediaType: 'unknown', mediaDurationSec: null };
}

/**
 * Extrae el msg al que responde este mensaje, si existe.
 */
function extractReplyTo(message) {
  const ctx =
    message?.extendedTextMessage?.contextInfo ??
    message?.imageMessage?.contextInfo ??
    message?.videoMessage?.contextInfo ??
    null;
  return ctx?.stanzaId ?? null;
}

/**
 * Normaliza JID telefónico de WhatsApp (`<phone>@s.whatsapp.net`) a E.164 sin '+'.
 * Devuelve null para JIDs anónimos (`@lid`) o cualquier otro tipo.
 */
function phoneJidToE164(jid) {
  if (!jid) return null;
  if (!jid.includes('@s.whatsapp.net')) return null;
  return jid.split('@')[0].split(':')[0];
}

/**
 * Resuelve el teléfono real del sender en grupos lid-mode.
 *
 * En grupos modernos (`addressingMode: 'lid'`) `msg.key.participant` puede
 * venir como `<lid>@lid`. WhatsApp incluye en paralelo:
 *   msg.key.participantPn  → `<phone>@s.whatsapp.net`  (teléfono real)
 *   msg.key.participantLid → `<lid>@lid`               (LID anónimo)
 *
 * Preferimos siempre el teléfono. Si no está disponible, devolvemos null
 * (mejor saltar el mensaje que persistir un LID confundible con un E.164).
 */
function resolveSenderPhone(msg) {
  const candidates = [
    msg.key?.participantPn,
    msg.key?.participant,
    msg.participant
  ];
  for (const jid of candidates) {
    const phone = phoneJidToE164(jid);
    if (phone) return phone;
  }
  return null;
}

/**
 * Handler principal para evento messages.upsert de Baileys.
 * Cada evento puede traer varios mensajes en m.messages.
 */
export async function handleIncomingMessages(m, sock) {
  // 'notify' = mensaje nuevo en tiempo real
  // 'append' = mensajes sincronizados desde historial al reconectar
  if (m.type !== 'notify' && m.type !== 'append') return;

  const isHistory = m.type === 'append';

  for (const msg of m.messages) {
    try {
      if (m.type === 'notify') markHealthy();

      if (!msg.key || !msg.message) continue;
      if (msg.key.fromMe) continue;
      if (!msg.key.remoteJid?.endsWith('@g.us')) continue;   // Solo grupos

      const groupJid = msg.key.remoteJid;
      const senderPhone = resolveSenderPhone(msg);
      if (!senderPhone) {
        logger.debug(
          {
            msgId: msg.key.id,
            groupJid,
            participant: msg.key.participant,
            participantPn: msg.key.participantPn
          },
          'Skipping message without resolvable phone (likely lid-only sender)'
        );
        continue;
      }
      const whatsappMsgId = msg.key.id;
      const timestamp = new Date((msg.messageTimestamp ?? Date.now() / 1000) * 1000);

      // Intentar obtener el nombre del grupo desde metadata
      let groupName = 'unknown';
      try {
        const md = await sock.groupMetadata(groupJid);
        groupName = md?.subject ?? 'unknown';
      } catch (err) {
        logger.debug({ err, groupJid }, 'Could not fetch group metadata');
      }

      // 1) upsert group
      const group = await upsertGroup({ whatsappId: groupJid, name: groupName });

      // 2) upsert participant
      const participant = await upsertParticipant({
        groupId: group.id,
        phone: senderPhone,
        displayName: msg.pushName ?? null
      });

      // 3) extract content + insert message
      const { content, mediaType, mediaDurationSec, reactionTargetId } = extractContent(msg.message);

      // Skip reactions with no emoji (e.g. reaction removed)
      if (mediaType === 'reaction' && !content) continue;

      const replyTo = reactionTargetId ?? extractReplyTo(msg.message);

      const inserted = await insertMessage({
        whatsapp_msg_id: whatsappMsgId,
        group_id: group.id,
        sender_phone: senderPhone,
        sender_role: participant.role,
        sender_display_name: msg.pushName ?? null,
        timestamp: timestamp.toISOString(),
        content,
        media_type: mediaType,
        media_duration_sec: mediaDurationSec,
        reply_to_msg_id: replyTo,
        is_forwarded: Boolean(msg.message?.extendedTextMessage?.contextInfo?.isForwarded),
        raw_json: msg.message,
        analyzed: false
      });

      if (inserted) {
        logger.info(
          {
            groupName,
            senderPhone,
            hasContent: Boolean(content),
            mediaType,
            isHistory,
            contentPreview: content?.slice(0, 80) ?? null
          },
          isHistory ? 'Historical message ingested' : 'Message ingested'
        );

        // Download & store media for images and documents (non-blocking)
        if (mediaType === 'image' || mediaType === 'document') {
          downloadAndStoreMedia(msg, sock, group.id, inserted.id)
            .then((mediaUrl) => {
              if (mediaUrl) updateMessageMediaUrl(inserted.id, mediaUrl);
            })
            .catch((err) => logger.warn({ err, msgId: inserted.id }, 'Media pipeline error'));
        }
      }
    } catch (err) {
      logger.error({ err, msgId: msg?.key?.id }, 'Failed to handle message');
    }
  }
}

/**
 * Handler para cambios en participantes del grupo. Útil para detectar
 * additions/removals y mantener la tabla participants al día.
 */
export async function handleGroupParticipantsUpdate(update, sock) {
  try {
    const { id: groupJid, participants: participantJids, action } = update;

    const md = await sock.groupMetadata(groupJid).catch(() => null);
    const groupName = md?.subject ?? 'unknown';
    const group = await upsertGroup({ whatsappId: groupJid, name: groupName });

    logger.info({ groupName, action, count: participantJids.length }, 'Group participants updated');

    if (action === 'add' || action === 'promote') {
      // Cuando llega un add/promote sólo conocemos el JID que mandó el evento.
      // En grupos lid-mode puede ser un @lid; en ese caso no podemos saber el
      // teléfono real sin pedir el roster, así que recargamos metadata y
      // upserteamos al participante usando la entrada con `.jid` de ahí.
      const lookup = new Map();
      for (const p of md?.participants ?? []) {
        const jid = phoneJidToE164(p.jid) ?? phoneJidToE164(p.id);
        if (!jid) continue;
        lookup.set(p.id, jid);
        if (p.lid) lookup.set(p.lid, jid);
      }

      for (const jid of participantJids) {
        const phone = lookup.get(jid) ?? phoneJidToE164(jid);
        if (!phone) {
          logger.debug({ jid, groupName }, 'Cannot resolve phone for new participant; skipping');
          continue;
        }
        await upsertParticipant({
          groupId: group.id,
          phone,
          displayName: null
        });
      }
    }
  } catch (err) {
    logger.error({ err, update }, 'Failed to handle group participants update');
  }
}
