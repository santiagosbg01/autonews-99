import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { logger } from './logger.js';
import { uploadFile, downloadFile, listFiles } from './supabase.js';

/**
 * Empaqueta el directorio auth_state en un .tar.gz en memoria y lo sube al bucket.
 * Estrategia simple: zipea JSON-a-JSON sin tar (Baileys auth_state es un flat dir de ~15 archivos).
 * Retiene 14 días, rota automáticamente.
 */
export async function backupAuthState() {
  const dir = config.listener.authStateDir;
  try {
    await fs.access(dir);
  } catch {
    logger.warn({ dir }, 'auth_state dir does not exist; skipping backup');
    return;
  }

  const files = await fs.readdir(dir);
  if (files.length === 0) {
    logger.warn({ dir }, 'auth_state dir is empty; skipping backup');
    return;
  }

  const bundle = {};
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) continue;
    bundle[file] = (await fs.readFile(fullPath)).toString('base64');
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const remotePath = `auth_state/auth_${ts}.json`;
  const payload = Buffer.from(JSON.stringify(bundle));

  await uploadFile(remotePath, payload);
  logger.info({ remotePath, fileCount: Object.keys(bundle).length, sizeBytes: payload.length }, 'auth_state backup uploaded');

  await rotateBackups();
}

/**
 * Mantiene solo los últimos 14 backups (uno por hora = ~14 días).
 */
async function rotateBackups() {
  try {
    const files = await listFiles('auth_state');
    const toDelete = files.slice(14);
    if (toDelete.length === 0) return;

    for (const f of toDelete) {
      const { supabase } = await import('./supabase.js');
      await supabase.storage
        .from(config.supabase.storageBucket)
        .remove([`auth_state/${f.name}`]);
    }
    logger.debug({ deletedCount: toDelete.length }, 'auth_state backup rotation complete');
  } catch (err) {
    logger.warn({ err }, 'auth_state rotation failed (non-fatal)');
  }
}

/**
 * Restaura el último backup al directorio local.
 * Llamar ANTES de inicializar Baileys si auth_state local no existe o está corrupto.
 */
export async function restoreLatestAuthState() {
  const dir = config.listener.authStateDir;
  const files = await listFiles('auth_state');
  if (!files || files.length === 0) {
    logger.info('No auth_state backup found in Storage');
    return false;
  }

  const latest = files[0];
  logger.info({ name: latest.name }, 'Restoring auth_state from latest backup');

  const blob = await downloadFile(`auth_state/${latest.name}`);
  const text = await blob.text();
  const bundle = JSON.parse(text);

  await fs.mkdir(dir, { recursive: true });
  for (const [filename, b64] of Object.entries(bundle)) {
    await fs.writeFile(path.join(dir, filename), Buffer.from(b64, 'base64'));
  }
  logger.info({ fileCount: Object.keys(bundle).length }, 'auth_state restored');
  return true;
}

/**
 * Lanza un interval que sube el auth_state cada N minutos.
 * Devuelve el handle para que se pueda limpiar en shutdown.
 */
export function startBackupInterval() {
  const intervalMs = config.listener.authBackupIntervalMin * 60 * 1000;
  logger.info({ intervalMin: config.listener.authBackupIntervalMin }, 'Starting auth_state backup interval');
  const handle = setInterval(() => {
    backupAuthState().catch((err) =>
      logger.error({ err }, 'auth_state backup interval failed')
    );
  }, intervalMs);
  return handle;
}
