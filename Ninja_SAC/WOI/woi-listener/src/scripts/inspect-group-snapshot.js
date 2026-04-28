#!/usr/bin/env node
/**
 * Diagnóstico: imprime una muestra del snapshot de groupFetchAllParticipating
 * para entender el formato actual de participants (id vs jid vs lid) en cada
 * grupo. No escribe nada en Supabase.
 */
import {
  default as makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers
} from '@whiskeysockets/baileys';
import { config } from '../config.js';
import { logger } from '../logger.js';

const { state, saveCreds } = await useMultiFileAuthState(config.listener.authStateDir);
const { version } = await fetchLatestBaileysVersion();

const baileysLogger = logger.child({ module: 'baileys-inspect' });
baileysLogger.level = 'silent';

const sock = makeWASocket({
  version,
  auth: state,
  printQRInTerminal: false,
  browser: Browsers.macOS('InspectGroups'),
  syncFullHistory: false,
  markOnlineOnConnect: false,
  logger: baileysLogger
});

sock.ev.on('creds.update', saveCreds);

await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('connection timeout')), 60_000);
  sock.ev.on('connection.update', async (u) => {
    if (u.connection === 'open') {
      clearTimeout(t);
      const snap = await sock.groupFetchAllParticipating();
      const groups = Object.values(snap);
      console.log(JSON.stringify({
        groupCount: groups.length,
        addressingModes: groups.reduce((acc, g) => {
          acc[g.addressingMode || 'unknown'] = (acc[g.addressingMode || 'unknown'] ?? 0) + 1;
          return acc;
        }, {}),
        sample: groups.slice(0, 3).map((g) => ({
          subject: g.subject,
          addressingMode: g.addressingMode,
          size: g.size,
          firstParticipants: g.participants.slice(0, 4).map((p) => ({
            id: p.id,
            lid: p.lid,
            jid: p.jid,
            name: p.name,
            notify: p.notify,
            admin: p.admin
          }))
        }))
      }, null, 2));
      try { await sock.end(); } catch {}
      resolve();
    }
    if (u.connection === 'close') {
      clearTimeout(t);
      try { await sock.end(); } catch {}
      reject(new Error(`closed: ${u.lastDisconnect?.error?.output?.statusCode ?? '?'}`));
    }
  });
});

process.exit(0);
