import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers
} from '@whiskeysockets/baileys';
import qrcodeTerminal from 'qrcode-terminal';
import fs from 'node:fs/promises';
import { config } from './config.js';
import { logger } from './logger.js';
import { handleIncomingMessages, handleGroupParticipantsUpdate } from './message-handler.js';
import { backupAuthState, restoreLatestAuthState, startBackupInterval } from './auth-backup.js';
import { startHealthcheckLoop, markHealthy } from './healthcheck.js';
import { upsertGroup } from './supabase.js';
import { ensureMediaBucket } from './media-downloader.js';

let currentSock = null;
let backupHandle = null;
let healthcheckHandle = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Si auth_state local no existe, intenta restaurar desde Supabase Storage.
 */
async function ensureAuthState() {
  try {
    const files = await fs.readdir(config.listener.authStateDir);
    if (files.length > 0) {
      logger.info({ fileCount: files.length }, 'Local auth_state found');
      return;
    }
  } catch {
    logger.info('Local auth_state missing, attempting restore from Storage');
  }

  try {
    const restored = await restoreLatestAuthState();
    if (!restored) {
      logger.info('No backup available; será necesario escanear QR nuevamente');
    }
  } catch (err) {
    logger.warn({ err }, 'Restore from Storage failed; proceeding with fresh auth (QR required)');
  }
}

async function start() {
  await ensureAuthState();
  await ensureMediaBucket();

  const { state, saveCreds } = await useMultiFileAuthState(config.listener.authStateDir);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info({ version, isLatest }, 'Using Baileys version');

  const baileysLogger = logger.child({ module: 'baileys' });
  baileysLogger.level = config.logging.level === 'debug' ? 'debug' : 'silent';

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: true,
    markOnlineOnConnect: false,
    logger: baileysLogger
  });

  currentSock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info('QR code received, scan with WhatsApp');
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === 'open') {
      reconnectAttempts = 0;
      markHealthy();
      logger.info(
        {
          user: sock.user?.id,
          displayName: sock.user?.name
        },
        'Connection OPEN'
      );
      await backupAuthState().catch((err) =>
        logger.error({ err }, 'Initial auth_state backup failed')
      );

      // Scan y registrar todos los grupos donde está el bot
      setTimeout(async () => {
        try {
          const participating = await sock.groupFetchAllParticipating();
          const groups = Object.values(participating);
          logger.info({ count: groups.length }, 'Scanning joined groups');
          for (const g of groups) {
            await upsertGroup({ whatsappId: g.id, name: g.subject }).catch((err) =>
              logger.warn({ err, groupId: g.id }, 'Failed to upsert group during scan')
            );
          }
          logger.info({ count: groups.length }, 'Group scan complete');
        } catch (err) {
          logger.warn({ err }, 'Group scan failed');
        }
      }, 3000);
    }

    if (connection === 'close') {
      const statusCode =
        lastDisconnect?.error?.output?.statusCode ??
        lastDisconnect?.error?.statusCode ??
        null;

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.warn(
        { statusCode, shouldReconnect, error: lastDisconnect?.error?.message },
        'Connection CLOSED'
      );

      if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts += 1;
        const delay = Math.min(5000 * reconnectAttempts, 60000);
        logger.info({ reconnectAttempts, delayMs: delay }, 'Scheduling reconnect');
        setTimeout(() => start().catch((err) => logger.fatal({ err }, 'Reconnect failed')), delay);
      } else if (statusCode === DisconnectReason.loggedOut) {
        logger.fatal('Logged out; auth_state inválido. Eliminar auth_state/ y re-escanear QR.');
        process.exit(1);
      } else {
        logger.fatal({ reconnectAttempts }, 'Max reconnect attempts reached. Exiting.');
        process.exit(1);
      }
    }
  });

  sock.ev.on('messages.upsert', (m) => {
    handleIncomingMessages(m, sock).catch((err) =>
      logger.error({ err }, 'messages.upsert handler crashed')
    );
  });

  sock.ev.on('group-participants.update', (update) => {
    handleGroupParticipantsUpdate(update, sock).catch((err) =>
      logger.error({ err }, 'group-participants.update handler crashed')
    );
  });

  if (!backupHandle) backupHandle = startBackupInterval();
  if (!healthcheckHandle) healthcheckHandle = startHealthcheckLoop(() => currentSock);

  return sock;
}

async function shutdown(signal) {
  logger.info({ signal }, 'Shutdown requested');
  if (backupHandle) clearInterval(backupHandle);
  if (healthcheckHandle) clearInterval(healthcheckHandle);
  try {
    await backupAuthState();
  } catch (err) {
    logger.error({ err }, 'Final auth_state backup failed');
  }
  if (currentSock) {
    try {
      await currentSock.end();
    } catch (err) {
      logger.warn({ err }, 'Error closing socket');
    }
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled rejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  shutdown('uncaughtException');
});

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start listener');
  process.exit(1);
});
