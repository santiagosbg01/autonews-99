import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_STORAGE_BUCKET'
];

const optional = ['SLACK_HEALTHCHECK_WEBHOOK'];

const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(
    `[config] Missing required env vars: ${missing.join(', ')}\n` +
    `Copia .env.example a .env y llena los valores.`
  );
  process.exit(1);
}

const missingOptional = optional.filter((k) => !process.env[k]);
if (missingOptional.length > 0) {
  console.warn(`[config] Optional env vars not set: ${missingOptional.join(', ')}`);
}

export const config = {
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    storageBucket: process.env.SUPABASE_STORAGE_BUCKET
  },
  slack: {
    healthcheckWebhook: process.env.SLACK_HEALTHCHECK_WEBHOOK
  },
  listener: {
    displayName: process.env.LISTENER_DISPLAY_NAME || '99min Ops Monitor',
    authBackupIntervalMin: Number(process.env.LISTENER_AUTH_BACKUP_INTERVAL_MIN || 60),
    healthcheckIntervalSec: Number(process.env.LISTENER_HEALTHCHECK_INTERVAL_SEC || 300),
    authStateDir: path.resolve(__dirname, '../auth_state')
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: path.resolve(__dirname, '../logs')
  }
};
