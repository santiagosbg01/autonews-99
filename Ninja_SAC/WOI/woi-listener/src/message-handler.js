import { logger } from './logger.js';
import { upsertGroup, upsertParticipant, insertMessage } from './supabase.js';
import { markHealthy } from './healthcheck.js';

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
 * Normaliza JID de WhatsApp (participant) a E.164 sin '+'.
 */
function jidToPhone(jid) {
  if (!jid) return null;
  return jid.split('@')[0].split(':')[0];
}

/**
 * Handler principal para evento messages.upsert de Baileys.
 * Cada evento puede traer varios mensajes en m.messages.
 */
export async function handleIncomingMessages(m, sock) {
  if (m.type !== 'notify') return;

  for (const msg of m.messages) {
    try {
      markHealthy();

      if (!msg.key || !msg.message) continue;
      if (msg.key.fromMe) continue;                // Nunca procesar mensajes que enviamos
      if (!msg.key.remoteJid?.endsWith('@g.us')) continue;   // Solo grupos

      const groupJid = msg.key.remoteJid;
      const senderJid = msg.key.participant ?? msg.participant ?? null;
      if (!senderJid) continue;

      const senderPhone = jidToPhone(senderJid);
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
      const { content, mediaType, mediaDurationSec } = extractContent(msg.message);
      const replyTo = extractReplyTo(msg.message);

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
            contentPreview: content?.slice(0, 80) ?? null
          },
          'Message ingested'
        );
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
      for (const jid of participantJids) {
        await upsertParticipant({
          groupId: group.id,
          phone: jidToPhone(jid),
          displayName: null
        });
      }
    }
  } catch (err) {
    logger.error({ err, update }, 'Failed to handle group participants update');
  }
}
