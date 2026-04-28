#!/usr/bin/env node
/**
 * One-shot: conecta a WhatsApp con el auth_state existente, pide la lista
 * completa de participantes de cada grupo y hace upsert en la tabla
 * `participants` (con auto-clasificación contra `known_agents`).
 *
 * Útil cuando el listener lleva tiempo en grupos silenciosos o nuevos:
 * la tabla `participants` solo se llena al ver mensajes / eventos add/leave,
 * así que grupos sin tráfico aparecen vacíos en el dashboard. Este script
 * los rellena pidiendo el roster directamente a Baileys.
 *
 * Uso (desde woi-listener/):
 *   npm run sync-participants
 *
 * Estrategia:
 *   1) abre el socket y espera connection=open
 *   2) llama a groupFetchAllParticipating() — un único snapshot de todos
 *      los grupos con sus participantes
 *   3) cierra el socket inmediatamente para no chocar con el listener si
 *      arranca en paralelo, ni con WhatsApp que a veces reemplaza la sesión
 *   4) procesa el snapshot upserteando todo en Supabase (idempotente)
 *
 * NO ejecutar mientras el listener principal está corriendo: comparten
 * auth_state y WhatsApp echará al que llegó primero.
 */
import {
  default as makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason
} from '@whiskeysockets/baileys';
import { config } from '../config.js';
import { logger } from '../logger.js';
import {
  upsertGroup,
  upsertParticipant,
  reconcileGroupParticipants,
  autoPromoteAgents
} from '../supabase.js';

const log = logger.child({ module: 'sync-participants' });

const FETCH_TIMEOUT_MS = 60_000;
const MAX_FETCH_ATTEMPTS = 3;

/** JID '5215581234567@s.whatsapp.net' → '5215581234567'. Devuelve null si no es un JID telefónico. */
function jidToPhone(jid) {
  if (!jid) return null;
  if (!jid.includes('@s.whatsapp.net')) return null; // descartamos @lid, @broadcast, etc.
  return jid.split('@')[0].split(':')[0];
}

/**
 * En grupos modernos (addressingMode: 'lid') WhatsApp expone:
 *   participant.id  → '<lid>@lid'           (identificador anónimo, NO es teléfono)
 *   participant.lid → '<lid>@lid'           (mismo LID)
 *   participant.jid → '<phone>@s.whatsapp.net'   (teléfono real, lo que queremos)
 *
 * Preferimos siempre `jid`. Si no existe (grupos pn-mode antiguos), `id`
 * suele ser el JID telefónico directamente.
 */
function extractPhone(participant) {
  return jidToPhone(participant.jid) ?? jidToPhone(participant.id);
}

/** Abre un socket, espera connection=open, devuelve el snapshot de grupos y cierra. */
async function fetchSnapshotOnce() {
  const { state, saveCreds } = await useMultiFileAuthState(config.listener.authStateDir);
  const { version } = await fetchLatestBaileysVersion();

  const baileysLogger = logger.child({ module: 'baileys-sync' });
  baileysLogger.level = 'silent';

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.macOS('SyncParticipants'),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    logger: baileysLogger
  });

  sock.ev.on('creds.update', saveCreds);

  return await new Promise((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      sock.end(new Error('fetch snapshot timeout'));
      reject(new Error(`Timed out after ${FETCH_TIMEOUT_MS}ms waiting for connection.open`));
    }, FETCH_TIMEOUT_MS);

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u;

      if (qr) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { await sock.end(); } catch { /* ignore */ }
        return reject(new Error('auth_state vacío — Baileys está pidiendo QR. Re-escanea con `npm run qr`.'));
      }

      if (connection === 'close') {
        const code =
          lastDisconnect?.error?.output?.statusCode ??
          lastDisconnect?.error?.statusCode ??
          null;
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        return reject(new Error(`Connection closed before snapshot (statusCode=${code})`));
      }

      if (connection !== 'open') return;
      if (settled) return;

      try {
        log.info('Connection open — fetching snapshot of all participating groups');
        const snapshot = await sock.groupFetchAllParticipating();
        // El JID del propio bot listener — lo excluimos del roster (no es un
        // humano participante, es el monitor). Sin esto cuenta como miembro de
        // los 60 grupos e infla el conteo.
        const ownJid = sock.user?.id ?? null;
        const ownPhone = jidToPhone(ownJid);
        settled = true;
        clearTimeout(timeout);
        log.info({ groupCount: Object.keys(snapshot).length, ownPhone }, 'Snapshot fetched, closing socket');
        try { await sock.end(); } catch { /* ignore */ }
        resolve({ snapshot, ownPhone });
      } catch (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { await sock.end(); } catch { /* ignore */ }
        reject(err);
      }
    });
  });
}

/** Hace fetchSnapshotOnce con retries en errores transitorios (440 connectionReplaced, etc). */
async function fetchSnapshot() {
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await fetchSnapshotOnce();
    } catch (err) {
      lastErr = err;
      // loggedOut → no tiene sentido reintentar
      if (
        err.message?.includes('loggedOut') ||
        String(err.message ?? '').includes(`statusCode=${DisconnectReason.loggedOut}`) ||
        err.message?.includes('QR')
      ) {
        throw err;
      }
      const backoff = 2000 * attempt;
      log.warn({ err, attempt, backoff }, 'Snapshot fetch failed; retrying');
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr ?? new Error('Snapshot fetch failed (unknown reason)');
}

async function main() {
  log.info('Starting participant sync — opening Baileys socket');
  const { snapshot, ownPhone } = await fetchSnapshot();
  const groups = Object.values(snapshot);
  log.info({ ownPhone }, 'Excluding own listener bot phone from rosters');

  const stats = {
    groupsTotal: groups.length,
    groupsSynced: 0,
    participants: 0,
    agentsAuto: 0,
    skippedNoPhone: 0,
    deletedStale: 0,
    errors: 0
  };

  // CLI flags:
  //   --no-reconcile  → solo upsert, no borrar (modo legacy)
  const args = new Set(process.argv.slice(2));
  const reconcile = !args.has('--no-reconcile');
  log.info({ reconcile, groupCount: groups.length }, 'Sync mode');

  for (const g of groups) {
    try {
      const groupRow = await upsertGroup({ whatsappId: g.id, name: g.subject });
      const members = g.participants ?? [];
      log.info(
        {
          group: g.subject,
          memberCount: members.length,
          addressingMode: g.addressingMode
        },
        'Syncing group roster'
      );

      // Phones canónicos del grupo según el snapshot fresco de Baileys.
      // Sólo E.164 válidos — extractPhone descarta @lid, @broadcast, etc.
      const canonicalPhones = [];

      for (const member of members) {
        const phone = extractPhone(member);
        if (!phone) {
          stats.skippedNoPhone += 1;
          log.debug(
            { group: g.subject, memberId: member.id, lid: member.lid, jid: member.jid },
            'Skipping member without resolvable phone'
          );
          continue;
        }
        // Excluir al propio bot listener (no es un humano participante).
        if (ownPhone && phone === ownPhone) {
          continue;
        }
        try {
          const p = await upsertParticipant({
            groupId: groupRow.id,
            phone,
            displayName: member.name ?? member.notify ?? null
          });
          stats.participants += 1;
          if (p?.role === 'agente_99') stats.agentsAuto += 1;
          canonicalPhones.push(phone);
        } catch (err) {
          stats.errors += 1;
          log.warn({ err, phone, group: g.subject }, 'Failed to upsert participant');
        }
      }

      // Reconciliación: borrar participantes que ya no están en el grupo
      // (incluye LIDs legacy y gente que salió). Solo se ejecuta si todo el
      // upsert anterior fue exitoso, para no borrar por error en caso de un
      // snapshot parcial.
      if (reconcile) {
        try {
          const { deleted } = await reconcileGroupParticipants({
            groupId: groupRow.id,
            keepPhones: canonicalPhones
          });
          if (deleted > 0) {
            stats.deletedStale += deleted;
            log.info(
              { group: g.subject, deleted, kept: canonicalPhones.length },
              'Reconciled: removed stale participants'
            );
          }
        } catch (err) {
          stats.errors += 1;
          log.warn({ err, group: g.subject }, 'Failed to reconcile group participants');
        }
      }

      stats.groupsSynced += 1;
    } catch (err) {
      stats.errors += 1;
      log.error({ err, groupId: g.id, subject: g.subject }, 'Failed to sync group');
    }
  }

  // Auto-promoción: cualquier phone que esté en >1 grupo con role='otro' (o
  // null) pasa a 'agente_99'. Una persona externa al equipo nunca está en
  // múltiples chats internos. Idempotente: si ya fue promovido en runs
  // previos, no hace nada.
  try {
    const { promoted } = await autoPromoteAgents();
    stats.autoPromotedAgents = promoted;
    if (promoted > 0) {
      log.info({ promoted }, 'Auto-promoted multi-group phones to agente_99');
    }
  } catch (err) {
    stats.errors += 1;
    log.warn({ err }, 'autoPromoteAgents failed');
  }

  log.info(stats, 'Sync complete');
}

main()
  .then(() => {
    log.info('Done — exiting cleanly');
    process.exit(0);
  })
  .catch((err) => {
    log.fatal({ err }, 'sync-all-participants failed');
    process.exit(1);
  });
