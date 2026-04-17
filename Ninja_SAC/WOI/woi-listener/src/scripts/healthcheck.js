#!/usr/bin/env node
/**
 * Healthcheck standalone (usado por launchd o cron externo para verificar
 * que el listener está vivo desde fuera del proceso).
 *
 * Consulta la tabla messages y verifica que haya habido al menos 1 ingest
 * en los últimos 15 minutos en horario pico (9-20h local).
 *
 * Exit codes:
 *   0 = healthy
 *   1 = stale (sin mensajes recientes en horario pico)
 *   2 = error conectando a Supabase
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const now = new Date();
const hourCDMX = Number(
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    hour: '2-digit',
    hour12: false
  }).format(now)
);

const isPeakHour = hourCDMX >= 9 && hourCDMX <= 20;
const STALE_THRESHOLD_MIN = isPeakHour ? 15 : 60;
const since = new Date(Date.now() - STALE_THRESHOLD_MIN * 60 * 1000).toISOString();

try {
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .gte('ingested_at', since);

  if (error) {
    console.error('[healthcheck] Supabase error:', error.message);
    process.exit(2);
  }

  if (count > 0) {
    console.log(`[healthcheck] OK — ${count} messages ingested since ${since}`);
    process.exit(0);
  }

  console.error(
    `[healthcheck] STALE — 0 messages in last ${STALE_THRESHOLD_MIN}min (peakHour=${isPeakHour})`
  );
  process.exit(1);
} catch (err) {
  console.error('[healthcheck] crashed:', err.message);
  process.exit(2);
}
