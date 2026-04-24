/**
 * End-of-Day Check — verifica que no se hayan perdido mensajes del día.
 * Se puede correr como cron job a las 11pm o manualmente.
 *
 * Uso: node src/eod-check.js
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const MX_TZ_OFFSET = -6; // UTC-6

function startOfDayUTC() {
  const now = new Date();
  // Convertir a hora MX
  const mxNow = new Date(now.getTime() + MX_TZ_OFFSET * 60 * 60 * 1000);
  const startMX = new Date(Date.UTC(mxNow.getUTCFullYear(), mxNow.getUTCMonth(), mxNow.getUTCDate(), 0, 0, 0));
  // Convertir de vuelta a UTC
  return new Date(startMX.getTime() - MX_TZ_OFFSET * 60 * 60 * 1000);
}

async function run() {
  const startOfToday = startOfDayUTC();
  const now = new Date();

  console.log(`\n📋 EOD Check — ${now.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`);
  console.log(`   Revisando mensajes desde ${startOfToday.toISOString()}\n`);

  // Obtener grupos activos
  const { data: groups, error } = await sb
    .from('groups')
    .select('id, name')
    .eq('is_active', true)
    .order('name');

  if (error) { console.error('Error fetching groups:', error); process.exit(1); }

  let totalMsgs = 0;
  let groupsWithActivity = 0;
  let groupsWithGaps = [];

  for (const g of groups) {
    // Mensajes de hoy
    const { count: todayCount } = await sb
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('group_id', g.id)
      .gte('timestamp', startOfToday.toISOString());

    // Último mensaje
    const { data: lastMsg } = await sb
      .from('messages')
      .select('timestamp')
      .eq('group_id', g.id)
      .order('timestamp', { ascending: false })
      .limit(1);

    const last = lastMsg?.[0]?.timestamp ? new Date(lastMsg[0].timestamp) : null;
    const minsSinceLast = last ? Math.round((now - last) / 60000) : null;
    const count = todayCount ?? 0;

    totalMsgs += count;
    if (count > 0) groupsWithActivity++;

    // Detectar posibles gaps: sin mensajes en más de 2 horas en hora laboral
    const mxHour = new Date(now.getTime() + MX_TZ_OFFSET * 60 * 60 * 1000).getUTCHours();
    const isBusinessHours = mxHour >= 8 && mxHour <= 20;
    const hasGap = isBusinessHours && minsSinceLast !== null && minsSinceLast > 120;

    const status = count === 0 ? '⚪' : hasGap ? '🟡' : '🟢';
    const lastStr = last
      ? `último hace ${minsSinceLast}m`
      : 'sin mensajes';

    console.log(`  ${status} ${g.name.padEnd(40)} ${String(count).padStart(3)} msgs hoy  |  ${lastStr}`);

    if (hasGap) {
      groupsWithGaps.push({ name: g.name, minsSinceLast });
    }
  }

  console.log(`\n  Total: ${totalMsgs} mensajes en ${groupsWithActivity}/${groups.length} grupos activos`);

  if (groupsWithGaps.length > 0) {
    console.log(`\n⚠️  Posibles gaps detectados (>2h sin mensajes en horario laboral):`);
    for (const g of groupsWithGaps) {
      console.log(`   - ${g.name}: ${g.minsSinceLast} minutos sin mensajes`);
    }
    console.log(`\n   → Considera exportar e importar esos chats manualmente.`);
  } else {
    console.log(`\n✅ Sin gaps detectados. Sincronización correcta.`);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
