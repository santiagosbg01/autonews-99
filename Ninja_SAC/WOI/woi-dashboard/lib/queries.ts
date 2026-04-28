import { supabaseAdmin } from './supabase'

export type GroupSummary = {
  id: number
  name: string
  whatsapp_id: string
  pilot_cohort: string
  timezone: string
  is_active: boolean
  vertical: string | null
  client_name: string | null
  country: string | null
  messages_today: number
  messages_week: number
  open_incidents: number
  bucket_b_today: number
  avg_sentiment: number | null
  avg_ttfr_minutes: number | null
  avg_ttr_minutes: number | null
  last_message_at: string | null
  // Health score (last-7-days window)
  incidents_total_7d: number
  incidents_resolved_7d: number
  incidents_escalated_7d: number
  health: HealthScore
  // Message mix breakdown (last 7 days, classified messages only)
  mix: MessageMix
}

// ─── Message Mix (Operativos / Incidencias / Ruido) ─────────────────────────
// Each classified message is bucketed into one of three groups:
//   A · Operativos  → confirmaciones, presentaciones, reporte_entrega
//   B · Incidencias → problemas (unidad, horario, sistema, etc.)
//   C · Ruido       → saludos, acuses, consultas, "otro"
export type MessageMix = {
  total: number             // total classified messages in the window
  operativos: number        // bucket A count
  incidencias: number       // bucket B count
  ruido: number             // bucket C count
  pct_operativos: number    // 0..100 (rounded)
  pct_incidencias: number
  pct_ruido: number
}

export const MIX_META = {
  operativos:  { label: 'Operativos',  color: '#10b981', bg: '#ecfdf5', border: '#a7f3d0', desc: 'Confirmaciones, presentaciones y reportes de entrega — la operación corriendo bien.' },
  incidencias: { label: 'Incidencias', color: '#ef4444', bg: '#fef2f2', border: '#fecaca', desc: 'Problemas reportados (unidad, horario, sistema, robo) — requieren atención.' },
  ruido:       { label: 'Ruido',       color: '#94a3b8', bg: '#f1f5f9', border: '#cbd5e1', desc: 'Saludos, acuses, consultas y mensajes sin información operativa accionable.' },
} as const

export function emptyMix(): MessageMix {
  return { total: 0, operativos: 0, incidencias: 0, ruido: 0, pct_operativos: 0, pct_incidencias: 0, pct_ruido: 0 }
}

export function computeMix(buckets: { A: number; B: number; C: number }): MessageMix {
  const total = buckets.A + buckets.B + buckets.C
  if (total === 0) return emptyMix()
  const pa = (buckets.A / total) * 100
  const pb = (buckets.B / total) * 100
  // Round so the 3 percentages always add up to 100
  const ra = Math.round(pa)
  const rb = Math.round(pb)
  const rc = Math.max(0, 100 - ra - rb)
  return {
    total,
    operativos: buckets.A,
    incidencias: buckets.B,
    ruido: buckets.C,
    pct_operativos: ra,
    pct_incidencias: rb,
    pct_ruido: rc,
  }
}

// ─── Client Health Score ────────────────────────────────────────────────────
// Composite 0–100 score per group. Higher = healthier client relationship.
//
// Formula (weights match product spec):
//   sentiment    40%  → ((avg_sentiment + 1) / 2) * 100   (−1..+1 → 0..100)
//   resolution   30%  → resolved_7d / total_7d * 100
//   TTFR vs SLA 20%  → 100 * SLA_MIN / max(SLA_MIN, ttfr_min)   (clamped)
//   escalations 10%  → max(0, 100 − 200 * escalation_rate)       (50% esc = 0)
//
// Defaults when there's no data:
//   - avg_sentiment null → 50 (neutral)
//   - 0 incidents in 7d  → resolution = 100, TTFR = 100, esc = 100
//                          (no signal yet → don't penalize the client)

export const HEALTH_SLA_TTFR_MIN = 30 // SLA target for time-to-first-response

export type HealthScore = {
  total: number             // 0..100, rounded
  sentiment: number         // 0..100
  resolution: number        // 0..100
  ttfr: number              // 0..100
  escalations: number       // 0..100
  band: 'critical' | 'warning' | 'watch' | 'healthy'
  // Raw inputs surfaced so the breakdown UI can explain "why"
  inputs: {
    avg_sentiment: number | null
    avg_ttfr_minutes: number | null
    incidents_total_7d: number
    incidents_resolved_7d: number
    incidents_escalated_7d: number
    sla_ttfr_minutes: number
  }
}

export function computeHealthScore(input: {
  avg_sentiment: number | null
  avg_ttfr_minutes: number | null
  incidents_total_7d: number
  incidents_resolved_7d: number
  incidents_escalated_7d: number
}): HealthScore {
  const SLA = HEALTH_SLA_TTFR_MIN

  const sentiment = input.avg_sentiment != null
    ? Math.max(0, Math.min(100, ((input.avg_sentiment + 1) / 2) * 100))
    : 50

  const total = input.incidents_total_7d
  const resolution = total > 0
    ? Math.max(0, Math.min(100, (input.incidents_resolved_7d / total) * 100))
    : 100

  const ttfr = input.avg_ttfr_minutes == null || total === 0
    ? 100
    : Math.max(0, Math.min(100, (SLA / Math.max(SLA, input.avg_ttfr_minutes)) * 100))

  const escRate = total > 0 ? input.incidents_escalated_7d / total : 0
  const escalations = Math.max(0, 100 - 200 * escRate)

  const composite = 0.4 * sentiment + 0.3 * resolution + 0.2 * ttfr + 0.1 * escalations
  const totalScore = Math.round(composite)

  const band: HealthScore['band'] =
    totalScore < 55 ? 'critical' :
    totalScore < 70 ? 'warning'  :
    totalScore < 80 ? 'watch'    : 'healthy'

  return {
    total: totalScore,
    sentiment: Math.round(sentiment),
    resolution: Math.round(resolution),
    ttfr: Math.round(ttfr),
    escalations: Math.round(escalations),
    band,
    inputs: {
      avg_sentiment: input.avg_sentiment,
      avg_ttfr_minutes: input.avg_ttfr_minutes,
      incidents_total_7d: input.incidents_total_7d,
      incidents_resolved_7d: input.incidents_resolved_7d,
      incidents_escalated_7d: input.incidents_escalated_7d,
      sla_ttfr_minutes: SLA,
    },
  }
}

export type GroupDetail = {
  id: number
  name: string
  whatsapp_id: string
  pilot_cohort: string
  timezone: string
  notes: string | null
  joined_at: string
  business_hour_start: number
  business_hour_end: number
  business_days: string[]
}

export type MessageRow = {
  id: number
  sender_display_name: string | null
  sender_phone: string
  sender_role: string | null
  timestamp: string
  content: string | null
  media_type: string | null
  analyzed: boolean
  analysis: {
    category: string
    bucket: string
    sentiment: number | null
    urgency: string | null
    reasoning: string | null
  } | null
}

export type Participant = {
  id: number
  phone: string
  display_name: string | null
  role: string
  confirmed_by_santi: boolean
  last_seen_at: string
}

export type TicketStatus = 'abierto' | 'respondido' | 'resuelto' | 'escalado' | 'pendiente' | 'no_resuelto_eod'

export type IncidentRow = {
  id: number
  opened_at: string
  closed_at: string | null
  category: string | null
  urgency: string | null
  is_open: boolean
  status: TicketStatus
  message_count: number
  ttfr_seconds: number | null
  ttr_seconds: number | null
  owner_phone: string | null
  summary: string | null
  first_response_at: string | null
  first_response_by: string | null
  sentiment_avg: number | null
  escalated_at: string | null
  escalated_reason: string | null
  resolution_source: string | null
  resolution_reason: string | null
}

export type TicketRow = IncidentRow & {
  group_id: number
  group_name: string
  client_name: string | null
  country: string | null
  vertical: string | null
  opener_phone: string | null
  opener_display_name: string | null
  // denormalized from participants for owner display
  owner_name: string | null
}

export const TICKET_STATUS_META: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  abierto:         { label: 'Abierto',         color: '#f59e0b', bg: '#fffbeb', dot: '●' },
  respondido:      { label: 'Respondido',      color: '#3b82f6', bg: '#eff6ff', dot: '●' },
  pendiente:       { label: 'Pendiente',       color: '#f97316', bg: '#fff7ed', dot: '◌' },
  escalado:        { label: 'Escalado',        color: '#ef4444', bg: '#fef2f2', dot: '▲' },
  resuelto:        { label: 'Resuelto',        color: '#10b981', bg: '#f0fdf4', dot: '✓' },
  no_resuelto_eod: { label: 'No resuelto EOD', color: '#b91c1c', bg: '#fef2f2', dot: '⊘' },
}

export const RESOLUTION_SOURCE_META: Record<string, { label: string; emoji: string; color: string }> = {
  agent_signal:    { label: 'Cerrado por agente',          emoji: '👤', color: '#16a34a' },
  customer_signal: { label: 'Confirmado por cliente',      emoji: '✅', color: '#16a34a' },
  inactivity:      { label: 'Cerrado por inactividad',     emoji: '⏱',  color: '#0ea5e9' },
  sonnet_thread:   { label: 'Resolución detectada por IA', emoji: '🤖', color: '#7c3aed' },
  eod_resolved:    { label: 'Resuelto al cierre del día',  emoji: '🌙', color: '#7c3aed' },
  eod_unresolved:  { label: 'Sin resolución al EOD',       emoji: '🌙', color: '#b91c1c' },
  manual:          { label: 'Cerrado manualmente',         emoji: '✏️', color: '#475569' },
}

export const CATEGORY_ES: Record<string, string> = {
  problema_unidad:       'Problema unidad',
  problema_horario:      'Problema horario',
  problema_entrada:      'Problema entrada CD',
  problema_salida:       'Problema salida CD',
  problema_trafico:      'Tráfico / acceso',
  problema_manifestacion:'Manifestación',
  robo_incidencia:       'Robo / incidencia',
  problema_sistema:      'Sistema / plataforma',
  problema_proveedor:    'Proveedor externo',
  confirmacion_resolucion:'Resolución confirmada',
  presentacion_unidad:   'Presentación unidad',
  presentacion_chofer:   'Presentación chofer',
  presentacion_auxiliar: 'Presentación auxiliar',
  confirmacion_llegada:  'Confirmación llegada',
  confirmacion_salida:   'Confirmación salida',
  reporte_entrega:       'Reporte de entrega',
  confirmacion_evidencias:'Confirmación evidencias',
  acuse_recibo:          'Acuse de recibo',
  consulta_info:         'Consulta / información',
  saludo_ruido:          'Saludo / ruido',
  otro:                  'Otro',
}

/** Returns midnight of today in America/Mexico_City expressed as a UTC Date. */
function startOfDayCDMX(): Date {
  const now = new Date()
  // Parse "now" as if it were local CDMX time to get the CDMX wall-clock values
  const cdmxNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))
  // Offset = how far UTC is ahead of CDMX interpretation (e.g. 5h in CDT, 6h in CST)
  const offsetMs = now.getTime() - cdmxNow.getTime()
  // Set to midnight in CDMX local values
  const cdmxMidnight = new Date(cdmxNow)
  cdmxMidnight.setHours(0, 0, 0, 0)
  // Convert back to UTC
  return new Date(cdmxMidnight.getTime() + offsetMs)
}

export async function getGroupsSummary(): Promise<GroupSummary[]> {
  const now = new Date()
  const startOfToday = startOfDayCDMX()
  const startOfWeek = new Date(now)
  startOfWeek.setDate(now.getDate() - 7)

  const { data: groups, error } = await supabaseAdmin
    .from('groups')
    .select('id, name, whatsapp_id, pilot_cohort, timezone, is_active, vertical, client_name, country')
    .eq('is_active', true)
    .order('name')

  if (error || !groups) return []

  const summaries = await Promise.all(
    groups.map(async (g) => {
      const [
        { count: messages_today },
        { count: messages_week },
        { count: open_incidents },
        { data: analysisToday },
        { data: analysisWeek },
        { data: lastMsg },
        { data: incidentsWeek },
      ] = await Promise.all([
        supabaseAdmin.from('messages').select('*', { count: 'exact', head: true })
          .eq('group_id', g.id).gte('timestamp', startOfToday.toISOString()),
        supabaseAdmin.from('messages').select('*', { count: 'exact', head: true })
          .eq('group_id', g.id).gte('timestamp', startOfWeek.toISOString()),
        supabaseAdmin.from('incidents').select('*', { count: 'exact', head: true })
          .eq('group_id', g.id).eq('is_open', true),
        supabaseAdmin.from('messages')
          .select('analysis(bucket, sentiment)')
          .eq('group_id', g.id)
          .gte('timestamp', startOfToday.toISOString())
          .not('analysis', 'is', null),
        // 7d bucket-only fetch for the message-mix breakdown
        supabaseAdmin.from('messages')
          .select('analysis(bucket)')
          .eq('group_id', g.id)
          .gte('timestamp', startOfWeek.toISOString())
          .not('analysis', 'is', null),
        supabaseAdmin.from('messages').select('timestamp')
          .eq('group_id', g.id).order('timestamp', { ascending: false }).limit(1),
        // Pull all 7d incidents once → derive total/resolved/escalated/ttfr/ttr in JS
        supabaseAdmin.from('incidents')
          .select('ttfr_seconds, ttr_seconds, closed_at, escalated_at')
          .eq('group_id', g.id)
          .gte('opened_at', startOfWeek.toISOString()),
      ])

      const analyses = (analysisToday ?? []).map((m: any) => m.analysis).filter(Boolean)
      const bucket_b_today = analyses.filter((a: any) => a.bucket === 'B').length
      const sentiments = analyses.map((a: any) => a.sentiment).filter((s: any) => s !== null)
      const avg_sentiment = sentiments.length > 0
        ? sentiments.reduce((a: number, b: number) => a + b, 0) / sentiments.length
        : null

      // Last-7d bucket counts → message mix
      const weekBuckets = { A: 0, B: 0, C: 0 }
      for (const m of analysisWeek ?? []) {
        const a = (m as any).analysis
        if (!a?.bucket) continue
        if (a.bucket === 'A' || a.bucket === 'B' || a.bucket === 'C') {
          weekBuckets[a.bucket as 'A' | 'B' | 'C'] += 1
        }
      }
      const mix = computeMix(weekBuckets)

      const incidents = incidentsWeek ?? []
      const incidents_total_7d = incidents.length
      const incidents_resolved_7d = incidents.filter((i: any) => i.closed_at != null).length
      const incidents_escalated_7d = incidents.filter((i: any) => i.escalated_at != null).length
      // TTFR/TTR (horario laboral) — promedios SOLO sobre tickets cerrados para
      // que la población esté alineada (TTR ≥ TTFR garantizado).
      const closedIncs = incidents.filter((i: any) => i.closed_at != null)
      const ttfrs = closedIncs.map((i: any) => i.ttfr_seconds).filter((s: any) => s !== null)
      const avg_ttfr_minutes = ttfrs.length > 0
        ? Math.round(ttfrs.reduce((a: number, b: number) => a + b, 0) / ttfrs.length / 60)
        : null
      const ttrs = closedIncs.map((i: any) => i.ttr_seconds).filter((s: any) => s !== null)
      const avg_ttr_minutes = ttrs.length > 0
        ? Math.round(ttrs.reduce((a: number, b: number) => a + b, 0) / ttrs.length / 60)
        : null

      const health = computeHealthScore({
        avg_sentiment,
        avg_ttfr_minutes,
        incidents_total_7d,
        incidents_resolved_7d,
        incidents_escalated_7d,
      })

      return {
        ...g,
        messages_today: messages_today ?? 0,
        messages_week: messages_week ?? 0,
        open_incidents: open_incidents ?? 0,
        bucket_b_today,
        avg_sentiment,
        avg_ttfr_minutes,
        avg_ttr_minutes,
        last_message_at: lastMsg?.[0]?.timestamp ?? null,
        incidents_total_7d,
        incidents_resolved_7d,
        incidents_escalated_7d,
        health,
        mix,
      }
    })
  )

  return summaries
}

/** Per-group message mix for last N days (used by group detail page). */
export async function getGroupMessageMix(groupId: number, days = 7): Promise<MessageMix> {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - days)
  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('analysis(bucket)')
    .eq('group_id', groupId)
    .gte('timestamp', since.toISOString())
    .not('analysis', 'is', null)
  if (error) return emptyMix()
  const buckets = { A: 0, B: 0, C: 0 }
  for (const m of data ?? []) {
    const a = (m as any).analysis
    if (a?.bucket === 'A' || a?.bucket === 'B' || a?.bucket === 'C') {
      buckets[a.bucket as 'A' | 'B' | 'C'] += 1
    }
  }
  return computeMix(buckets)
}

/** Portfolio-wide message mix for last N days (used by /analytics). */
export async function getPortfolioMessageMix(days = 7): Promise<MessageMix> {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - days)
  // Single aggregated query — we group in SQL via the analysis relation count.
  // Supabase doesn't support GROUP BY in PostgREST, so we pull the rows and
  // tally in JS. To keep the payload small, only the bucket column is fetched.
  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('analysis(bucket)')
    .gte('timestamp', since.toISOString())
    .not('analysis', 'is', null)
  if (error) return emptyMix()
  const buckets = { A: 0, B: 0, C: 0 }
  for (const m of data ?? []) {
    const a = (m as any).analysis
    if (a?.bucket === 'A' || a?.bucket === 'B' || a?.bucket === 'C') {
      buckets[a.bucket as 'A' | 'B' | 'C'] += 1
    }
  }
  return computeMix(buckets)
}

/**
 * Compute the Client Health Score for a single group (last 7 days).
 * Cheaper than calling getGroupsSummary if you only need health for one group.
 */
export async function getGroupHealth(groupId: number): Promise<HealthScore> {
  const startOfWeek = new Date()
  startOfWeek.setDate(startOfWeek.getDate() - 7)

  const [{ data: incidentsWeek }, { data: messagesWeek }] = await Promise.all([
    supabaseAdmin.from('incidents')
      .select('ttfr_seconds, closed_at, escalated_at')
      .eq('group_id', groupId)
      .gte('opened_at', startOfWeek.toISOString()),
    supabaseAdmin.from('messages')
      .select('analysis(sentiment)')
      .eq('group_id', groupId)
      .gte('timestamp', startOfWeek.toISOString())
      .not('analysis', 'is', null),
  ])

  const incidents = incidentsWeek ?? []
  const incidents_total_7d = incidents.length
  const incidents_resolved_7d = incidents.filter((i: any) => i.closed_at != null).length
  const incidents_escalated_7d = incidents.filter((i: any) => i.escalated_at != null).length
  const ttfrs = incidents.map((i: any) => i.ttfr_seconds).filter((s: any) => s !== null)
  const avg_ttfr_minutes = ttfrs.length > 0
    ? Math.round(ttfrs.reduce((a: number, b: number) => a + b, 0) / ttfrs.length / 60)
    : null

  const sentiments = (messagesWeek ?? [])
    .map((m: any) => (Array.isArray(m.analysis) ? m.analysis[0]?.sentiment : m.analysis?.sentiment))
    .filter((s: any) => s !== null && s !== undefined)
  const avg_sentiment = sentiments.length > 0
    ? sentiments.reduce((a: number, b: number) => a + b, 0) / sentiments.length
    : null

  return computeHealthScore({
    avg_sentiment,
    avg_ttfr_minutes,
    incidents_total_7d,
    incidents_resolved_7d,
    incidents_escalated_7d,
  })
}

export async function getGroupDetail(id: number): Promise<GroupDetail | null> {
  const { data, error } = await supabaseAdmin
    .from('groups')
    .select('id, name, whatsapp_id, pilot_cohort, timezone, notes, joined_at, business_hour_start, business_hour_end, business_days')
    .eq('id', id)
    .single()
  if (error) return null
  return data
}

export const VALID_BUSINESS_DAYS = ['mon','tue','wed','thu','fri','sat','sun'] as const
export type BusinessDay = typeof VALID_BUSINESS_DAYS[number]

export async function updateGroupBusinessHours(
  groupId: number,
  hourStart: number,
  hourEnd: number,
  days: string[],
): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isInteger(hourStart) || hourStart < 0 || hourStart > 23) {
    return { ok: false, error: 'business_hour_start fuera de rango (0-23)' }
  }
  if (!Number.isInteger(hourEnd) || hourEnd < 1 || hourEnd > 24) {
    return { ok: false, error: 'business_hour_end fuera de rango (1-24)' }
  }
  if (hourEnd <= hourStart) {
    return { ok: false, error: 'business_hour_end debe ser > business_hour_start' }
  }
  const validDays = days.filter((d): d is BusinessDay =>
    (VALID_BUSINESS_DAYS as readonly string[]).includes(d)
  )
  if (validDays.length === 0) {
    return { ok: false, error: 'Selecciona al menos un día laboral' }
  }
  const { error } = await supabaseAdmin
    .from('groups')
    .update({
      business_hour_start: hourStart,
      business_hour_end: hourEnd,
      business_days: validDays,
    })
    .eq('id', groupId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function getGroupMessages(groupId: number, limit = 50): Promise<MessageRow[]> {
  const { data, error } = await supabaseAdmin
    .from('messages')
    .select(`
      id, sender_display_name, sender_phone, sender_role,
      timestamp, content, media_type, analyzed,
      analysis(category, bucket, sentiment, urgency, reasoning)
    `)
    .eq('group_id', groupId)
    .order('timestamp', { ascending: false })
    .limit(limit)

  if (error) return []
  return (data ?? []).map((m: any) => ({
    ...m,
    analysis: Array.isArray(m.analysis) ? m.analysis[0] ?? null : m.analysis,
  }))
}

export async function getGroupParticipants(groupId: number): Promise<Participant[]> {
  const { data, error } = await supabaseAdmin
    .from('participants')
    .select('id, phone, display_name, role, confirmed_by_santi, last_seen_at')
    .eq('group_id', groupId)
    .order('role')
  if (error) return []
  return data ?? []
}

const INCIDENT_FIELDS = 'id, opened_at, closed_at, category, urgency, is_open, status, message_count, ttfr_seconds, ttr_seconds, owner_phone, summary, first_response_at, first_response_by, sentiment_avg, escalated_at, escalated_reason, resolution_source, resolution_reason'

export async function getGroupIncidents(groupId: number, limit = 30): Promise<IncidentRow[]> {
  const { data, error } = await supabaseAdmin
    .from('incidents')
    .select(INCIDENT_FIELDS)
    .eq('group_id', groupId)
    .order('opened_at', { ascending: false })
    .limit(limit)
  if (error) return []
  return (data ?? []).map((r: any) => ({ ...r, status: r.status ?? 'abierto' }))
}

export async function getAllTickets(
  limit = 300,
  statusFilter?: string,
): Promise<TicketRow[]> {
  let q = supabaseAdmin
    .from('incidents')
    .select(`${INCIDENT_FIELDS}, group_id, groups(name, client_name, country, vertical)`)
    .order('opened_at', { ascending: false })
    .limit(limit)
  if (statusFilter && statusFilter !== 'all') q = q.eq('status', statusFilter)

  const { data, error } = await q
  if (error || !data) return []

  // Fetch participant names for owner phones in batch
  const phones = [...new Set((data as any[]).map(r => r.owner_phone).filter(Boolean))]
  const nameMap: Record<string, string> = {}
  if (phones.length > 0) {
    const { data: parts } = await supabaseAdmin
      .from('participants')
      .select('phone, display_name')
      .in('phone', phones)
    for (const p of (parts ?? []) as any[]) {
      if (p.display_name) nameMap[p.phone] = p.display_name
    }
  }

  return (data as any[]).map(row => ({
    ...row,
    status:               row.status ?? 'abierto',
    group_name:           row.groups?.name ?? `grupo#${row.group_id}`,
    client_name:          row.groups?.client_name ?? null,
    country:              row.groups?.country ?? null,
    vertical:             row.groups?.vertical ?? null,
    owner_name:           row.owner_phone ? (nameMap[row.owner_phone] ?? null) : null,
    opener_phone:         row.owner_phone ?? null,
    opener_display_name:  row.owner_phone ? (nameMap[row.owner_phone] ?? null) : null,
    groups: undefined,
  })) as TicketRow[]
}

export type TicketDetail = TicketRow & {
  group_timezone: string
  messages: Array<{
    id: number
    timestamp: string
    sender_display_name: string | null
    sender_phone: string
    sender_role: string | null
    content: string | null
    media_type: string | null
    category: string | null
    bucket: string | null
    urgency: string | null
    sentiment: number | null
    reasoning: string | null
  }>
}

export async function getTicketDetail(id: number): Promise<TicketDetail | null> {
  const { data: inc, error } = await supabaseAdmin
    .from('incidents')
    .select(`${INCIDENT_FIELDS}, group_id, groups(name, timezone)`)
    .eq('id', id)
    .single()
  if (error || !inc) return null

  // Fetch linked messages via analysis.incident_id
  const { data: msgs } = await supabaseAdmin
    .from('analysis')
    .select(`
      message_id,
      category, bucket, urgency, sentiment, reasoning,
      messages(id, timestamp, sender_display_name, sender_phone, sender_role, content, media_type)
    `)
    .eq('incident_id', id)
    .order('message_id', { ascending: true })

  const messages = (msgs ?? []).map((a: any) => ({
    id:                   a.messages?.id ?? a.message_id,
    timestamp:            a.messages?.timestamp ?? '',
    sender_display_name:  a.messages?.sender_display_name ?? null,
    sender_phone:         a.messages?.sender_phone ?? '',
    sender_role:          a.messages?.sender_role ?? null,
    content:              a.messages?.content ?? null,
    media_type:           a.messages?.media_type ?? null,
    category:             a.category,
    bucket:               a.bucket,
    urgency:              a.urgency,
    sentiment:            a.sentiment,
    reasoning:            a.reasoning,
  })).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  const row = inc as any
  return {
    ...row,
    status: row.status ?? 'abierto',
    group_name: row.groups?.name ?? `grupo#${row.group_id}`,
    group_timezone: row.groups?.timezone ?? 'America/Mexico_City',
    owner_name: null,
    groups: undefined,
    messages,
  }
}

export async function updateParticipantRole(participantId: number, role: string): Promise<void> {
  await supabaseAdmin
    .from('participants')
    .update({ role, confirmed_by_santi: true })
    .eq('id', participantId)
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export type AgentLeaderboardRow = {
  agent_phone: string
  agent_name: string | null
  incidents_attended: number
  avg_ttfr_minutes: number | null
  avg_ttr_minutes: number | null
  resolved_count: number
  resolution_rate_pct: number | null
}

export async function getAgentLeaderboard(): Promise<AgentLeaderboardRow[]> {
  const { data, error } = await supabaseAdmin
    .from('vw_agent_leaderboard')
    .select('*')
    .order('avg_ttfr_minutes', { ascending: true })
  if (error) return []
  return data ?? []
}

// ─── Agent Role Analysis (T06) ──────────────────────────────────────────────
// Goes beyond vw_agent_leaderboard: classifies every agente_99 as
//   primary    → handles many incidents end-to-end (frontline)
//   supervisor → low first-response volume but heavy presence on alta-urgency
//                / escalated tickets (only steps in when things go wrong)
//   observer   → present in groups but rarely participates
//
// Heuristic rules (tunable):
//   primary     : incidents_attended >= 3
//                 (consistently first responder on multiple tickets)
//   supervisor  : incidents_attended < 3
//                 AND total_msgs >= 5
//                 AND (msgs_after_escalation_share >= 0.30
//                      OR alta_urgency_share        >= 0.50
//                      OR incidents_attended >= 1 AND avg_engagement_lag_min > 30)
//   observer    : everything else with total_msgs > 0

export type AgentRole = 'primary' | 'supervisor' | 'observer'

export const AGENT_ROLE_META: Record<AgentRole, {
  label: string; short: string; color: string; bg: string; border: string; desc: string
}> = {
  primary: {
    label: 'Primary responder',
    short: 'Primary',
    color: '#0369a1',
    bg:    '#eff6ff',
    border:'#bfdbfe',
    desc:  'Frontline. Toma muchos tickets como primer respondedor — opera el día a día.',
  },
  supervisor: {
    label: 'Supervisor / Escalación',
    short: 'Supervisor',
    color: '#b45309',
    bg:    '#fffbeb',
    border:'#fde68a',
    desc:  'Sólo entra cuando hay urgencia alta o el ticket fue escalado. Rol de respaldo / supervisión.',
  },
  observer: {
    label: 'Observador',
    short: 'Observador',
    color: '#475569',
    bg:    '#f8fafc',
    border:'#e2e8f0',
    desc:  'Presente en los grupos pero rara vez participa en la operación.',
  },
}

export type AgentAnalysisRow = {
  agent_phone:        string
  agent_name:         string | null
  role:               AgentRole
  // activity
  total_msgs:         number
  distinct_groups:    number
  distinct_incidents: number     // unique incidents the agent posted on
  group_names:        string[]   // top groups (max 3)
  // first-response performance
  incidents_attended: number     // = first_response_by count (this agent)
  avg_ttfr_min:       number | null
  resolved_count:     number
  resolution_rate_pct:number | null
  // engagement profile
  msgs_on_escalated:  number     // msgs sent on incidents that were escalated
  msgs_after_escalation: number  // msgs sent strictly after escalated_at
  msgs_on_alta:       number     // msgs sent on alta-urgency incidents
  share_escalated:    number     // 0..100  msgs_after_escalation / total_msgs
  share_alta:         number     // 0..100
  // recency
  last_active_at:     string | null
}

export async function getAgentAnalysis(
  from: string | Date | null,
  to:   string | Date | null,
  groupId: number | null = null,
): Promise<AgentAnalysisRow[]> {
  const fromIso = from instanceof Date ? from.toISOString() : from
  const toIso = to instanceof Date
    ? to.toISOString()
    : to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59` : to

  // 1) Pull all agente_99 messages in window (paginate up to 50k for safety).
  const PAGE = 1000
  const MAX  = 50000
  const allMsgs: Array<{
    id: number; group_id: number; sender_phone: string;
    sender_display_name: string | null; timestamp: string;
  }> = []
  for (let offset = 0; offset < MAX; offset += PAGE) {
    let q = supabaseAdmin
      .from('messages')
      .select('id, group_id, sender_phone, sender_display_name, timestamp')
      .eq('sender_role', 'agente_99')
      .not('sender_phone', 'is', null)
      .order('timestamp', { ascending: false })
      .range(offset, offset + PAGE - 1)
    if (fromIso) q = q.gte('timestamp', fromIso)
    if (toIso)   q = q.lte('timestamp', toIso)
    if (groupId) q = q.eq('group_id', groupId)
    const { data, error } = await q
    if (error || !data || data.length === 0) break
    allMsgs.push(...(data as any[]))
    if (data.length < PAGE) break
  }
  if (allMsgs.length === 0) return []

  // 2) Pull all incidents in window for cross-reference (escalation, urgency,
  //    first_response_by). We pull a slightly wider window so messages that
  //    arrive late on a slightly older incident still land on the right one.
  const widerFromIso = fromIso
    ? new Date(new Date(fromIso).getTime() - 7 * 86_400_000).toISOString()
    : null
  let iq = supabaseAdmin
    .from('incidents')
    .select('id, group_id, opened_at, closed_at, escalated_at, urgency, first_response_by, ttfr_seconds, ttr_seconds')
  if (widerFromIso) iq = iq.gte('opened_at', widerFromIso)
  if (toIso)        iq = iq.lte('opened_at', toIso)
  if (groupId)      iq = iq.eq('group_id', groupId)
  const { data: incRaw } = await iq
  const incidents = (incRaw ?? []) as Array<{
    id: number; group_id: number;
    opened_at: string; closed_at: string | null; escalated_at: string | null;
    urgency: string | null; first_response_by: string | null;
    ttfr_seconds: number | null; ttr_seconds: number | null;
  }>

  // Index incidents by group for fast lookup by message timestamp
  const incByGroup = new Map<number, typeof incidents>()
  for (const inc of incidents) {
    const arr = incByGroup.get(inc.group_id) ?? []
    arr.push(inc)
    incByGroup.set(inc.group_id, arr)
  }
  for (const arr of incByGroup.values()) {
    arr.sort((a, b) => a.opened_at.localeCompare(b.opened_at))
  }

  // For each msg, find the incident whose [opened_at .. closed_at|now] window
  // contains the msg timestamp. O(n log n) overall, small enough in JS.
  function findIncidentFor(groupId: number, ts: string) {
    const arr = incByGroup.get(groupId)
    if (!arr) return null
    // linear is fine for typical windows; with many incidents per group we'd
    // binary-search opened_at, but most groups have <100 incidents per period.
    for (let i = arr.length - 1; i >= 0; i--) {
      const inc = arr[i]
      if (ts < inc.opened_at) continue
      const closeBound = inc.closed_at ?? '9999-12-31'
      if (ts <= closeBound) return inc
      // Past the closed window of the most recent incident → no match
      return null
    }
    return null
  }

  // 3) Per-agent aggregation
  type Bucket = {
    name: string | null
    total_msgs: number
    groups: Set<number>
    incidents: Set<number>
    msgs_on_escalated: number
    msgs_after_escalation: number
    msgs_on_alta: number
    last_ts: string | null
    group_msg_count: Map<number, number>  // for top groups
  }
  const map = new Map<string, Bucket>()

  for (const m of allMsgs) {
    let b = map.get(m.sender_phone)
    if (!b) {
      b = {
        name: m.sender_display_name ?? null,
        total_msgs: 0, groups: new Set(), incidents: new Set(),
        msgs_on_escalated: 0, msgs_after_escalation: 0, msgs_on_alta: 0,
        last_ts: null, group_msg_count: new Map(),
      }
      map.set(m.sender_phone, b)
    }
    b.total_msgs++
    b.groups.add(m.group_id)
    b.group_msg_count.set(m.group_id, (b.group_msg_count.get(m.group_id) ?? 0) + 1)
    if (!b.last_ts || m.timestamp > b.last_ts) b.last_ts = m.timestamp
    if (b.name == null && m.sender_display_name) b.name = m.sender_display_name

    const inc = findIncidentFor(m.group_id, m.timestamp)
    if (inc) {
      b.incidents.add(inc.id)
      if (inc.urgency === 'alta') b.msgs_on_alta++
      if (inc.escalated_at) {
        b.msgs_on_escalated++
        if (m.timestamp >= inc.escalated_at) b.msgs_after_escalation++
      }
    }
  }

  // 4) First-response stats per agent (from incidents.first_response_by inside window)
  type FR = { count: number; resolved: number; ttfrs: number[] }
  const fr = new Map<string, FR>()
  for (const inc of incidents) {
    if (!inc.first_response_by) continue
    if (fromIso && inc.opened_at < fromIso) continue
    if (toIso   && inc.opened_at > toIso)   continue
    let f = fr.get(inc.first_response_by)
    if (!f) { f = { count: 0, resolved: 0, ttfrs: [] }; fr.set(inc.first_response_by, f) }
    f.count++
    if (inc.closed_at) f.resolved++
    if (inc.ttfr_seconds != null) f.ttfrs.push(inc.ttfr_seconds)
  }

  // 5) Group names lookup (only the ones we touched)
  const allGroupIds = new Set<number>()
  for (const b of map.values()) for (const g of b.groups) allGroupIds.add(g)
  const groupNames = new Map<number, string>()
  if (allGroupIds.size > 0) {
    const { data: gRaw } = await supabaseAdmin
      .from('groups')
      .select('id, name')
      .in('id', Array.from(allGroupIds))
    for (const g of (gRaw ?? []) as any[]) groupNames.set(g.id, g.name)
  }

  // 6) Build rows + classify
  const rows: AgentAnalysisRow[] = []
  for (const [phone, b] of map.entries()) {
    const f = fr.get(phone)
    const incidents_attended = f?.count ?? 0
    const avg_ttfr_min = f && f.ttfrs.length > 0
      ? Math.round(f.ttfrs.reduce((s, x) => s + x, 0) / f.ttfrs.length / 60)
      : null
    const resolution_rate_pct = f && f.count > 0
      ? Math.round((f.resolved / f.count) * 100)
      : null

    const share_escalated = b.total_msgs > 0
      ? Math.round((b.msgs_after_escalation / b.total_msgs) * 100)
      : 0
    const share_alta = b.total_msgs > 0
      ? Math.round((b.msgs_on_alta / b.total_msgs) * 100)
      : 0

    let role: AgentRole = 'observer'
    if (incidents_attended >= 3) {
      role = 'primary'
    } else if (b.total_msgs >= 5 && (
      share_escalated >= 30 ||
      share_alta      >= 50 ||
      (incidents_attended >= 1 && b.msgs_on_escalated > 0)
    )) {
      role = 'supervisor'
    } else {
      role = 'observer'
    }

    // Top-3 groups by msg volume for this agent
    const topGroups = Array.from(b.group_msg_count.entries())
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([gid]) => groupNames.get(gid) ?? `grupo#${gid}`)

    rows.push({
      agent_phone:         phone,
      agent_name:          b.name,
      role,
      total_msgs:          b.total_msgs,
      distinct_groups:     b.groups.size,
      distinct_incidents:  b.incidents.size,
      group_names:         topGroups,
      incidents_attended,
      avg_ttfr_min,
      resolved_count:      f?.resolved ?? 0,
      resolution_rate_pct,
      msgs_on_escalated:   b.msgs_on_escalated,
      msgs_after_escalation: b.msgs_after_escalation,
      msgs_on_alta:        b.msgs_on_alta,
      share_escalated,
      share_alta,
      last_active_at:      b.last_ts,
    })
  }

  // Default sort: primary → supervisor → observer, then by incidents_attended desc, then by total_msgs desc
  const ROLE_RANK: Record<AgentRole, number> = { primary: 0, supervisor: 1, observer: 2 }
  rows.sort((a, b) => {
    if (ROLE_RANK[a.role] !== ROLE_RANK[b.role]) return ROLE_RANK[a.role] - ROLE_RANK[b.role]
    if (b.incidents_attended !== a.incidents_attended) return b.incidents_attended - a.incidents_attended
    return b.total_msgs - a.total_msgs
  })

  return rows
}

export type AgentRoleCounts = Record<AgentRole, number>
export function summarizeAgentRoles(rows: AgentAnalysisRow[]): AgentRoleCounts {
  const out: AgentRoleCounts = { primary: 0, supervisor: 0, observer: 0 }
  for (const r of rows) out[r.role]++
  return out
}

export type OpenIncidentCross = {
  id: number
  group_id: number
  group_name: string
  pilot_cohort: string
  opened_at: string
  open_hours: number
  category: string | null
  urgency: string | null
  sentiment_avg: number | null
  owner_phone: string | null
  summary: string | null
  message_count: number
  ttfr_seconds: number | null
}

export async function getOpenIncidents(): Promise<OpenIncidentCross[]> {
  const { data, error } = await supabaseAdmin
    .from('vw_open_incidents')
    .select('*')
  if (error) return []
  return data ?? []
}

export type DailyReport = {
  id: number
  report_date: string
  total_messages: number
  bucket_a_count: number
  bucket_b_count: number
  bucket_c_count: number
  ratio_b: number | null
  incidents_opened: number
  incidents_closed: number
  avg_ttfr_seconds: number | null
  sonnet_narrative: string | null
  generated_at: string
}

export async function getDailyReports(limit = 14): Promise<DailyReport[]> {
  const { data, error } = await supabaseAdmin
    .from('daily_reports')
    .select('id, report_date, total_messages, bucket_a_count, bucket_b_count, bucket_c_count, ratio_b, incidents_opened, incidents_closed, avg_ttfr_seconds, sonnet_narrative, generated_at')
    .order('report_date', { ascending: false })
    .limit(limit)
  if (error) return []
  return data ?? []
}

export type GroupHealthDay = {
  group_id: number
  group_name: string
  day_local: string
  count_a: number
  count_b: number
  count_c: number
  total: number
  ratio_b_pct: number | null
  sentiment_avg: number | null
}

export type GroupAnalysis = {
  id: number
  analyzed_at: string
  window_start: string
  window_end: string
  message_count: number
  narrative: string
  insights: {
    key_topics: string[]
    anomalies: string[]
    recommendations: string[]
    dynamics: string
    client_sentiment_label: string
    risk_level: string
    risk_reason: string | null
  } | null
  participants_summary: Array<{
    name: string
    role: string
    behavior: string
  }> | null
  category_counts: Record<string, number> | null
}

export async function getLatestGroupAnalysis(groupId: number): Promise<GroupAnalysis | null> {
  const { data, error } = await supabaseAdmin
    .from('group_analyses')
    .select('id, analyzed_at, window_start, window_end, message_count, narrative, insights, participants_summary, category_counts')
    .eq('group_id', groupId)
    .order('analyzed_at', { ascending: false })
    .limit(1)
    .single()
  if (error || !data) return null
  return data as GroupAnalysis
}

export async function getGroupCategoryBreakdown(groupId: number, since: string): Promise<Record<string, number>> {
  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('analysis(category)')
    .eq('group_id', groupId)
    .gte('timestamp', since)
    .not('analysis', 'is', null)
  if (error || !data) return {}
  const counts: Record<string, number> = {}
  for (const m of data as any[]) {
    const cat = m.analysis?.category || (Array.isArray(m.analysis) ? m.analysis[0]?.category : null)
    if (cat) counts[cat] = (counts[cat] ?? 0) + 1
  }
  return counts
}

export type KpiSnapshot = {
  snapshot_date: string
  client_sentiment_avg: number | null
  overall_sentiment_avg: number | null
  total_messages: number
  bucket_a: number
  bucket_b: number
  bucket_c: number
  ratio_b: number | null
  incidents_opened: number
  incidents_closed: number
  avg_ttfr_seconds: number | null
  avg_ttr_seconds: number | null
  p90_ttfr_seconds: number | null
  risk_level: string | null
  anomaly_count: number
}

export async function getGroupKpiHistory(groupId: number, days = 30): Promise<KpiSnapshot[]> {
  const since = new Date()
  since.setDate(since.getDate() - days)
  const { data, error } = await supabaseAdmin
    .from('group_kpi_snapshots')
    .select('*')
    .eq('group_id', groupId)
    .gte('snapshot_date', since.toISOString().split('T')[0])
    .order('snapshot_date', { ascending: true })
  if (error) return []
  return data ?? []
}

// ---------------------------------------------------------------------------
// Media analysis
// ---------------------------------------------------------------------------

export type MediaAnalysisRow = {
  id: number
  message_id: number
  group_id: number
  group_name: string
  media_url: string
  media_category: string | null
  description: string | null
  extracted_text: string | null
  confidence: number | null
  analyzed_at: string
  // from messages join
  msg_timestamp: string
  sender_display_name: string | null
  sender_phone: string
  caption: string | null
}

const MEDIA_CATEGORY_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
  evidencia_entrega: { label: 'Evidencia entrega',  emoji: '📦', color: '#10b981' },
  estatus_ruta:      { label: 'Estatus en ruta',    emoji: '📍', color: '#3b82f6' },
  foto_vehiculo:     { label: 'Foto vehículo',       emoji: '🚛', color: '#6366f1' },
  id_conductor:      { label: 'ID conductor',        emoji: '🪪', color: '#f59e0b' },
  documento:         { label: 'Documento',           emoji: '📄', color: '#8b5cf6' },
  problema_fisico:   { label: 'Problema físico',     emoji: '⚠️', color: '#ef4444' },
  otro:              { label: 'Otro',                emoji: '🖼️', color: '#9ca3af' },
}
export { MEDIA_CATEGORY_LABELS }

export async function getMediaAnalysis(
  groupId?: number,
  category?: string,
  limit = 120,
): Promise<MediaAnalysisRow[]> {
  let q = supabaseAdmin
    .from('media_analysis')
    .select(`
      id, message_id, group_id, media_url, media_category, description,
      extracted_text, confidence, analyzed_at,
      groups(name),
      messages(timestamp, sender_display_name, sender_phone, content)
    `)
    .order('analyzed_at', { ascending: false })
    .limit(limit)

  if (groupId) q = q.eq('group_id', groupId)
  if (category) q = q.eq('media_category', category)

  const { data, error } = await q
  if (error || !data) return []

  return (data as any[]).map(row => ({
    id:                  row.id,
    message_id:          row.message_id,
    group_id:            row.group_id,
    group_name:          row.groups?.name ?? `grupo#${row.group_id}`,
    media_url:           row.media_url,
    media_category:      row.media_category,
    description:         row.description,
    extracted_text:      row.extracted_text,
    confidence:          row.confidence,
    analyzed_at:         row.analyzed_at,
    msg_timestamp:       row.messages?.timestamp ?? row.analyzed_at,
    sender_display_name: row.messages?.sender_display_name ?? null,
    sender_phone:        row.messages?.sender_phone ?? '',
    caption:             row.messages?.content ?? null,
  }))
}

export async function getMediaStats(groupId?: number): Promise<Record<string, number>> {
  let q = supabaseAdmin
    .from('media_analysis')
    .select('media_category')
  if (groupId) q = q.eq('group_id', groupId)
  const { data, error } = await q
  if (error || !data) return {}
  const counts: Record<string, number> = {}
  for (const row of data as any[]) {
    const cat = row.media_category ?? 'otro'
    counts[cat] = (counts[cat] ?? 0) + 1
  }
  return counts
}

// ─── Ticket status log ────────────────────────────────────────────────────────

export type TicketStatusLog = {
  id: number
  incident_id: number
  changed_at: string
  changed_by: string
  from_status: string | null
  to_status: string
  reason: string | null
  source: 'manual' | 'auto' | 'reconstructor'
}

export async function getTicketStatusLogs(incidentId: number): Promise<TicketStatusLog[]> {
  const { data, error } = await supabaseAdmin
    .from('ticket_status_logs')
    .select('*')
    .eq('incident_id', incidentId)
    .order('changed_at', { ascending: true })
  if (error || !data) return []
  return data as TicketStatusLog[]
}

// ─── Groups list for filters ──────────────────────────────────────────────────

export type GroupFilter = { id: number; name: string }

export async function getGroupFilters(): Promise<GroupFilter[]> {
  const { data, error } = await supabaseAdmin
    .from('groups')
    .select('id, name')
    .eq('is_active', true)
    .order('name')
  if (error || !data) return []
  return data as GroupFilter[]
}

// ─── Tickets with full filters ─────────────────────────────────────────────────

export async function getAllTicketsFiltered(opts: {
  status?: string
  groupId?: number
  category?: string
  urgency?: string
  limit?: number
}): Promise<TicketRow[]> {
  let q = supabaseAdmin
    .from('incidents')
    .select(`${INCIDENT_FIELDS}, group_id, groups(name, client_name, country, vertical)`)
    .order('opened_at', { ascending: false })
    .limit(opts.limit ?? 200)

  if (opts.status)    q = q.eq('status', opts.status)
  if (opts.groupId)   q = q.eq('group_id', opts.groupId)
  if (opts.category)  q = q.eq('category', opts.category)
  if (opts.urgency)   q = q.eq('urgency', opts.urgency)

  const { data, error } = await q
  if (error || !data) return []

  return (data as any[]).map(row => ({
    ...row,
    status:               row.status ?? 'abierto',
    group_name:           row.groups?.name ?? `grupo#${row.group_id}`,
    client_name:          row.groups?.client_name ?? null,
    country:              row.groups?.country ?? null,
    vertical:             row.groups?.vertical ?? null,
    owner_name:           row.owner_phone ?? null,
    opener_phone:         row.owner_phone ?? null,
    opener_display_name:  null,
    groups: undefined,
  })) as TicketRow[]
}

// ─── Incident category breakdown ─────────────────────────────────────────────

export type CategoryBreakdownItem = {
  category: string
  label: string
  count: number
  pct: number
  urgency_alta: number
  urgency_media: number
  urgency_baja: number
  avg_ttfr_min: number | null
  avg_ttr_min:  number | null   // time to resolution
  resolved:     number          // # closed in window
}

export async function getIncidentCategoryBreakdown(days = 30): Promise<CategoryBreakdownItem[]> {
  const since = new Date()
  since.setDate(since.getDate() - days)

  const { data, error } = await supabaseAdmin
    .from('incidents')
    .select('category, urgency, ttfr_seconds, ttr_seconds, closed_at')
    .gte('opened_at', since.toISOString())
    .not('category', 'is', null)

  if (error || !data) return []

  const map: Record<string, {
    count: number; alta: number; media: number; baja: number;
    ttfrs: number[]; ttrs: number[]; closed: number;
  }> = {}

  for (const row of data as any[]) {
    const cat = row.category as string
    if (!map[cat]) map[cat] = { count: 0, alta: 0, media: 0, baja: 0, ttfrs: [], ttrs: [], closed: 0 }
    map[cat].count++
    if (row.urgency === 'alta')  map[cat].alta++
    if (row.urgency === 'media') map[cat].media++
    if (row.urgency === 'baja')  map[cat].baja++
    // Promedios TTFR/TTR (horario laboral) sólo sobre tickets cerrados —
    // alinea población para que TTR ≥ TTFR siempre.
    if (row.closed_at) {
      if (row.ttfr_seconds != null) map[cat].ttfrs.push(row.ttfr_seconds)
      if (row.ttr_seconds  != null) map[cat].ttrs.push(row.ttr_seconds)
      map[cat].closed++
    }
  }

  const total = Object.values(map).reduce((s, v) => s + v.count, 0)
  if (total === 0) return []

  return Object.entries(map)
    .map(([cat, v]) => ({
      category:      cat,
      label:         CATEGORY_ES[cat] ?? cat.replace(/_/g, ' '),
      count:         v.count,
      pct:           Math.round((v.count / total) * 1000) / 10,
      urgency_alta:  v.alta,
      urgency_media: v.media,
      urgency_baja:  v.baja,
      avg_ttfr_min:  v.ttfrs.length > 0
        ? Math.round(v.ttfrs.reduce((a, b) => a + b, 0) / v.ttfrs.length / 60)
        : null,
      avg_ttr_min:   v.ttrs.length > 0
        ? Math.round(v.ttrs.reduce((a, b) => a + b, 0) / v.ttrs.length / 60)
        : null,
      resolved:      v.closed,
    }))
    .sort((a, b) => b.count - a.count)
}

// ─── Date range helpers ───────────────────────────────────────────────────────

export type RangeKey = 'hoy' | 'semana' | 'mes' | 'todos' | 'custom'

export function resolveDateRange(range: RangeKey, from?: string, to?: string): { from: Date | null; to: Date | null } {
  const now = new Date()
  const cdmx = 'America/Mexico_City'

  function startOfDayCDMX(d: Date): Date {
    const s = new Date(d.toLocaleString('en-US', { timeZone: cdmx }))
    s.setHours(0, 0, 0, 0)
    const offsetMs = d.getTime() - new Date(d.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
    return new Date(s.getTime() - offsetMs)
  }

  if (range === 'custom' && from && to) {
    return {
      from: new Date(from + 'T00:00:00-06:00'),
      to:   new Date(to   + 'T23:59:59-06:00'),
    }
  }
  if (range === 'todos') return { from: null, to: null }

  const todayStart = startOfDayCDMX(now)
  if (range === 'hoy') return { from: todayStart, to: now }

  const days = range === 'semana' ? 7 : 30
  const past = new Date(todayStart)
  past.setDate(past.getDate() - (days - 1))
  return { from: past, to: now }
}

export type GlobalKPIs = {
  total_groups: number
  messages_in_range: number
  incidents_in_range: number
  avg_sentiment_010: number | null   // 0–10 scale
  avg_ttfr_minutes: number | null    // first-response time
  avg_ttr_minutes:  number | null    // total resolution time
  // % de incidencias abiertas en el rango que se cerraron como 'resuelto'
  // dentro del MISMO día calendario (en la TZ del grupo). Excluye no_resuelto_eod.
  same_day_resolution_pct: number | null  // 0..100
  range_label: string
}

export async function getGlobalKPIs(range: RangeKey, from?: string, to?: string): Promise<GlobalKPIs> {
  const { from: f, to: t } = resolveDateRange(range, from, to)

  // 1. Active groups
  const { count: groupCount } = await supabaseAdmin
    .from('groups').select('id', { count: 'exact', head: true }).eq('is_active', true)

  // 2. Messages in range
  let msgQ = supabaseAdmin.from('messages').select('id', { count: 'exact', head: true })
  if (f) msgQ = msgQ.gte('timestamp', f.toISOString())
  if (t) msgQ = msgQ.lte('timestamp', t.toISOString())
  const { count: msgCount } = await msgQ

  // 3. Incidents opened in range — also pull fields needed for same-day-resolution KPI
  let incQ = supabaseAdmin
    .from('incidents')
    .select('id, ttfr_seconds, ttr_seconds, opened_at, closed_at, status, timezone', { count: 'exact' })
  if (f) incQ = incQ.gte('opened_at', f.toISOString())
  if (t) incQ = incQ.lte('opened_at', t.toISOString())
  const { data: incData, count: incCount } = await incQ

  // 4. Avg TTFR / TTR (horario laboral) — solo sobre tickets CERRADOS para
  // alinear poblaciones y garantizar TTR ≥ TTFR. Ver business_hours.py.
  const closedIncidents = (incData ?? []).filter((r: any) => r.closed_at != null)
  const ttfrs = closedIncidents.map((r: any) => r.ttfr_seconds).filter((v: any) => v != null) as number[]
  const ttrs  = closedIncidents.map((r: any) => r.ttr_seconds ).filter((v: any) => v != null) as number[]
  const avgTtfr = ttfrs.length > 0
    ? Math.round(ttfrs.reduce((a, b) => a + b, 0) / ttfrs.length / 60)
    : null
  const avgTtr = ttrs.length > 0
    ? Math.round(ttrs.reduce((a, b) => a + b, 0) / ttrs.length / 60)
    : null

  // 4b. Same-day resolution % — incidents whose opened_at and closed_at fall on
  //     the SAME calendar day in the group's tz, AND ended in 'resuelto'.
  //     Denominator: all incidents in range (any final state).
  const sameDayPct = computeSameDayResolutionPct(incData ?? [])

  // 5. Avg client sentiment in range (from analysis, only cliente/otro roles)
  let sentQ = supabaseAdmin
    .from('analysis')
    .select('sentiment, messages!inner(timestamp, sender_role)')
    .not('sentiment', 'is', null)
    .in('messages.sender_role', ['cliente', 'otro'])
  if (f) sentQ = (sentQ as any).gte('messages.timestamp', f.toISOString())
  if (t) sentQ = (sentQ as any).lte('messages.timestamp', t.toISOString())
  const { data: sentData } = await sentQ

  let avgSentiment010: number | null = null
  if (sentData && sentData.length > 0) {
    const vals = (sentData as any[]).map(r => Number(r.sentiment)).filter(v => !isNaN(v))
    if (vals.length > 0) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length
      avgSentiment010 = Math.round(((avg + 1) / 2) * 100) / 10  // -1..1 → 0..10, 1 decimal
    }
  }

  const rangeLabels: Record<string, string> = {
    hoy: 'Hoy', semana: 'Últimos 7 días', mes: 'Últimos 30 días',
    todos: 'Todo el tiempo', custom: `${from ?? ''} – ${to ?? ''}`,
  }

  return {
    total_groups:            groupCount ?? 0,
    messages_in_range:       msgCount   ?? 0,
    incidents_in_range:      incCount   ?? 0,
    avg_sentiment_010:       avgSentiment010,
    avg_ttfr_minutes:        avgTtfr,
    avg_ttr_minutes:         avgTtr,
    same_day_resolution_pct: sameDayPct,
    range_label:             rangeLabels[range] ?? range,
  }
}

// Returns the % of incidents opened in [from..to] (or all-time if both null)
// that closed as 'resuelto' on the same calendar day in their group's tz.
// Optionally filtered by groupId.
export async function getSameDayResolutionPct(
  from: string | null,
  to: string | null,
  groupId: number | null,
): Promise<{ pct: number | null; resolved_same_day: number; total: number; unresolved_eod: number }> {
  let q = supabaseAdmin
    .from('incidents')
    .select('group_id, opened_at, closed_at, status, timezone')
  if (from)    q = q.gte('opened_at', from)
  if (to)      q = q.lte('opened_at', to)
  if (groupId) q = q.eq('group_id', groupId)
  const { data } = await q
  const rows = data ?? []
  const pct = computeSameDayResolutionPct(rows)
  let resolvedSameDay = 0
  let unresolvedEod   = 0
  for (const r of rows) {
    if (r.status === 'no_resuelto_eod') unresolvedEod++
    if (r.status === 'resuelto' && r.closed_at && r.opened_at) {
      const tz = r.timezone || 'UTC'
      if (formatYmdInTz(r.opened_at, tz) === formatYmdInTz(r.closed_at, tz)) resolvedSameDay++
    }
  }
  return { pct, resolved_same_day: resolvedSameDay, total: rows.length, unresolved_eod: unresolvedEod }
}

// ---------------------------------------------------------------------------
// Same-day resolution helper
// ---------------------------------------------------------------------------
// Given a list of incident rows containing { opened_at, closed_at, status, timezone }
// returns the % (0..100) that were closed as 'resuelto' on the SAME calendar day
// in the incident's group timezone. Returns null when there are no incidents.
function computeSameDayResolutionPct(rows: any[]): number | null {
  if (!rows || rows.length === 0) return null
  let denom = 0
  let sameDayResolved = 0
  for (const r of rows) {
    if (!r.opened_at) continue
    denom++
    if (r.status !== 'resuelto' || !r.closed_at) continue
    const tz = r.timezone || 'UTC'
    const opened = formatYmdInTz(r.opened_at, tz)
    const closed = formatYmdInTz(r.closed_at, tz)
    if (opened && closed && opened === closed) sameDayResolved++
  }
  if (denom === 0) return null
  return Math.round((sameDayResolved / denom) * 1000) / 10  // 1 decimal
}

// Format an ISO timestamp as YYYY-MM-DD in a given IANA timezone.
// Uses Intl.DateTimeFormat which is supported on Node 18+ in Vercel/Railway.
function formatYmdInTz(iso: string, tz: string): string | null {
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return null
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    })
    return fmt.format(d)  // 'en-CA' yields YYYY-MM-DD
  } catch {
    // Fallback: UTC date portion of the ISO string.
    return iso.slice(0, 10) || null
  }
}

export async function getGroupHealthTrend(groupId: number, days = 14): Promise<GroupHealthDay[]> {
  const since = new Date()
  since.setDate(since.getDate() - days)
  const { data, error } = await supabaseAdmin
    .from('vw_group_daily_health')
    .select('*')
    .eq('group_id', groupId)
    .gte('day_local', since.toISOString().split('T')[0])
    .order('day_local', { ascending: true })
  if (error) return []
  return data ?? []
}

// ── Analytics time-series & scorecard ─────────────────────────────────────────

export type TimeSeriesPoint = {
  date: string            // YYYY-MM-DD
  messages: number
  incidents: number
  sentiment: number | null  // 0-10 scale
  ttfr_minutes: number | null  // Time to first response (substantive)
  ttr_minutes: number | null   // Time to resolution (full ticket lifecycle)
  resolution_rate: number | null  // 0-100
}

export type GroupScorecard = {
  id: number
  name: string
  client_name: string | null
  country: string | null
  vertical: string | null
  total_messages: number
  open_incidents: number
  avg_sentiment: number | null   // 0-10
  avg_ttfr_minutes: number | null
  avg_ttr_minutes: number | null   // time to resolution
  resolution_rate: number | null // 0-100
  same_day_resolution_pct: number | null  // 0-100, % de incidencias resueltas el mismo día
  sla_pct: number | null         // % responded within 15 min
  risk: 'high' | 'medium' | 'low'
}

export async function getAnalyticsTimeSeries(
  from: string | null,
  to: string | null,
  groupId: number | null,
): Promise<TimeSeriesPoint[]> {
  // Always build from group_kpi_snapshots (aggregated by date across groups)
  // This works even before daily_reports is populated.
  let q = supabaseAdmin
    .from('group_kpi_snapshots')
    .select('snapshot_date, total_messages, incidents_opened, incidents_closed, client_sentiment_avg, avg_ttfr_seconds, avg_ttr_seconds, group_id')
    .order('snapshot_date', { ascending: true })

  if (groupId) q = q.eq('group_id', groupId)
  if (from) q = q.gte('snapshot_date', from)
  if (to)   q = q.lte('snapshot_date', to)

  const { data } = await q
  if (!data || data.length === 0) return []

  // Aggregate by date across all groups
  const byDate = new Map<string, {
    messages: number; incidents: number; incidents_closed: number;
    sentiments: number[]; ttfrs: number[]; ttrs: number[];
  }>()

  for (const r of data as any[]) {
    const d = String(r.snapshot_date).slice(0, 10)
    if (!byDate.has(d)) byDate.set(d, { messages: 0, incidents: 0, incidents_closed: 0, sentiments: [], ttfrs: [], ttrs: [] })
    const e = byDate.get(d)!
    e.messages         += r.total_messages ?? 0
    e.incidents        += r.incidents_opened ?? 0
    e.incidents_closed += r.incidents_closed ?? 0
    if (r.client_sentiment_avg != null) e.sentiments.push(Number(r.client_sentiment_avg))
    if (r.avg_ttfr_seconds != null)     e.ttfrs.push(Number(r.avg_ttfr_seconds))
    if (r.avg_ttr_seconds  != null)     e.ttrs.push(Number(r.avg_ttr_seconds))
  }

  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => {
    const avgSent = v.sentiments.length > 0
      ? v.sentiments.reduce((a, b) => a + b, 0) / v.sentiments.length
      : null
    const avgTtfr = v.ttfrs.length > 0
      ? v.ttfrs.reduce((a, b) => a + b, 0) / v.ttfrs.length
      : null
    const avgTtr = v.ttrs.length > 0
      ? v.ttrs.reduce((a, b) => a + b, 0) / v.ttrs.length
      : null
    return {
      date,
      messages:  v.messages,
      incidents: v.incidents,
      sentiment: avgSent != null
        ? Math.round(((avgSent + 1) / 2) * 100) / 10   // -1..1 → 0..10
        : null,
      ttfr_minutes:    avgTtfr != null ? Math.round(avgTtfr / 60) : null,
      ttr_minutes:     avgTtr  != null ? Math.round(avgTtr  / 60) : null,
      resolution_rate: v.incidents > 0
        ? Math.round((v.incidents_closed / v.incidents) * 100)
        : null,
    }
  })
}

// ── Voice of Customer ─────────────────────────────────────────────────────────

export type VocQuote = {
  id: number
  content: string
  timestamp: string
  sentiment: number          // -1 to 1
  category: string | null
  urgency: string | null
  sender_display_name: string | null
  group_id: number
  group_name: string
  client_name: string | null
  country: string | null
  vertical: string | null
}

export type VocPattern = {
  country: string | null
  vertical: string | null
  category: string | null
  neg_count: number
  avg_sentiment: number
  sample_quote: string | null
  sample_group: string | null
}

const COUNTRY_FLAG: Record<string, string> = {
  MX: '🇲🇽', CL: '🇨🇱', CO: '🇨🇴', PE: '🇵🇪', AR: '🇦🇷',
}
export { COUNTRY_FLAG }

export async function getVocQuotes({
  from,
  to,
  polarity,
  country,
  vertical,
  groupId,
  limit = 40,
}: {
  from: string | null
  to: string | null
  polarity: 'negative' | 'positive' | 'both'
  country?: string | null
  vertical?: string | null
  groupId?: number | null
  limit?: number
}): Promise<VocQuote[]> {
  // Only client/otro messages with real content
  let q = supabaseAdmin
    .from('messages')
    .select(`
      id, content, timestamp, sender_display_name, sender_role, group_id,
      analysis!inner(sentiment, category, urgency),
      groups!inner(name, client_name, country, vertical)
    `)
    .in('sender_role', ['cliente', 'otro'])
    .not('content', 'is', null)
    .gt('content', '')           // non-empty
    .order('timestamp', { ascending: false })
    .limit(limit)

  if (polarity === 'negative') q = (q as any).lt('analysis.sentiment', -0.35)
  else if (polarity === 'positive') q = (q as any).gt('analysis.sentiment', 0.35)
  else q = (q as any).or('analysis.sentiment.lt.-0.35,analysis.sentiment.gt.0.35')

  if (from) q = q.gte('timestamp', new Date(from).toISOString())
  if (to)   q = q.lte('timestamp', new Date(to + 'T23:59:59').toISOString())
  if (groupId) q = q.eq('group_id', groupId)
  if (country)  q = (q as any).eq('groups.country', country)
  if (vertical) q = (q as any).eq('groups.vertical', vertical)

  const { data, error } = await q
  if (error || !data) return []

  return (data as any[])
    .filter(r => r.content && r.content.length > 15 && r.analysis)
    .map(r => ({
      id: r.id,
      content: r.content,
      timestamp: r.timestamp,
      sentiment: Number(Array.isArray(r.analysis) ? r.analysis[0]?.sentiment : r.analysis?.sentiment) || 0,
      category: (Array.isArray(r.analysis) ? r.analysis[0]?.category : r.analysis?.category) ?? null,
      urgency: (Array.isArray(r.analysis) ? r.analysis[0]?.urgency : r.analysis?.urgency) ?? null,
      sender_display_name: r.sender_display_name,
      group_id: r.group_id,
      group_name: (Array.isArray(r.groups) ? r.groups[0]?.name : r.groups?.name) ?? '',
      client_name: (Array.isArray(r.groups) ? r.groups[0]?.client_name : r.groups?.client_name) ?? null,
      country: (Array.isArray(r.groups) ? r.groups[0]?.country : r.groups?.country) ?? null,
      vertical: (Array.isArray(r.groups) ? r.groups[0]?.vertical : r.groups?.vertical) ?? null,
    }))
    .sort((a, b) => Math.abs(b.sentiment) - Math.abs(a.sentiment))
}

export async function getVocPatterns(from: string | null, to: string | null): Promise<VocPattern[]> {
  // Aggregate negative messages by country × vertical × category
  let q = supabaseAdmin
    .from('messages')
    .select(`
      group_id,
      content,
      analysis!inner(sentiment, category),
      groups!inner(name, country, vertical)
    `)
    .in('sender_role', ['cliente', 'otro'])
    .not('content', 'is', null)
    .lt('analysis.sentiment' as any, -0.25)
    .order('timestamp', { ascending: false })
    .limit(500)

  if (from) q = q.gte('timestamp', new Date(from).toISOString())
  if (to)   q = q.lte('timestamp', new Date(to + 'T23:59:59').toISOString())

  const { data } = await q
  if (!data) return []

  // Aggregate client-side
  const map = new Map<string, { neg_count: number; sentiments: number[]; sample: string | null; sample_group: string | null }>()
  for (const r of data as any[]) {
    const country  = (Array.isArray(r.groups) ? r.groups[0]?.country : r.groups?.country) ?? 'N/A'
    const vertical = (Array.isArray(r.groups) ? r.groups[0]?.vertical : r.groups?.vertical) ?? 'N/A'
    const category = (Array.isArray(r.analysis) ? r.analysis[0]?.category : r.analysis?.category) ?? 'otro'
    const sentiment = Number((Array.isArray(r.analysis) ? r.analysis[0]?.sentiment : r.analysis?.sentiment) || 0)
    const groupName = (Array.isArray(r.groups) ? r.groups[0]?.name : r.groups?.name) ?? ''
    const key = `${country}||${vertical}||${category}`
    if (!map.has(key)) map.set(key, { neg_count: 0, sentiments: [], sample: null, sample_group: null })
    const entry = map.get(key)!
    entry.neg_count++
    entry.sentiments.push(sentiment)
    if (!entry.sample && r.content && r.content.length > 20) {
      entry.sample = r.content.slice(0, 180)
      entry.sample_group = groupName
    }
  }

  const result: VocPattern[] = []
  for (const [key, v] of map.entries()) {
    const [country, vertical, category] = key.split('||')
    result.push({
      country: country === 'N/A' ? null : country,
      vertical: vertical === 'N/A' ? null : vertical,
      category: category === 'otro' ? null : category,
      neg_count: v.neg_count,
      avg_sentiment: v.sentiments.reduce((a, b) => a + b, 0) / v.sentiments.length,
      sample_quote: v.sample,
      sample_group: v.sample_group,
    })
  }
  return result.sort((a, b) => b.neg_count - a.neg_count).slice(0, 30)
}

export async function getVocSummaryKpis(from: string | null, to: string | null) {
  // Distinct countries and verticals with most negative voice
  const patterns = await getVocPatterns(from, to)
  const byCountry = new Map<string, number>()
  const byVertical = new Map<string, number>()
  const byCategory = new Map<string, number>()
  for (const p of patterns) {
    if (p.country) byCountry.set(p.country, (byCountry.get(p.country) ?? 0) + p.neg_count)
    if (p.vertical) byVertical.set(p.vertical, (byVertical.get(p.vertical) ?? 0) + p.neg_count)
    if (p.category) byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + p.neg_count)
  }
  const topCountry  = [...byCountry.entries()].sort((a, b) => b[1] - a[1])[0]
  const topVertical = [...byVertical.entries()].sort((a, b) => b[1] - a[1])[0]
  const topCategory = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]
  return { topCountry, topVertical, topCategory, patterns }
}

export async function getGroupScorecard(
  from: string | null,
  to: string | null,
): Promise<GroupScorecard[]> {
  // Pull per-group KPI snapshots aggregated over the date range
  let q = supabaseAdmin
    .from('group_kpi_snapshots')
    .select(`
      group_id,
      total_messages,
      bucket_b,
      incidents_opened,
      incidents_closed,
      client_sentiment_avg,
      avg_ttfr_seconds,
      avg_ttr_seconds,
      snapshot_date
    `)
    .order('snapshot_date', { ascending: false })
  if (from) q = q.gte('snapshot_date', from)
  if (to)   q = q.lte('snapshot_date', to)
  const { data: snapshots } = await q

  // Also get group meta
  const { data: groups } = await supabaseAdmin
    .from('groups')
    .select('id, name, client_name, country, vertical')
    .eq('is_active', true)

  const groupMap = new Map((groups ?? []).map((g: any) => [g.id, g]))

  // Aggregate per group
  const byGroup = new Map<number, any[]>()
  for (const s of (snapshots ?? [])) {
    if (!byGroup.has(s.group_id)) byGroup.set(s.group_id, [])
    byGroup.get(s.group_id)!.push(s)
  }

  // Get open incidents count per group
  const { data: openInc } = await supabaseAdmin
    .from('incidents')
    .select('group_id')
    .eq('is_open', true)
  const openByGroup = new Map<number, number>()
  for (const inc of (openInc ?? [])) {
    openByGroup.set(inc.group_id, (openByGroup.get(inc.group_id) ?? 0) + 1)
  }

  // Same-day resolution % per group: pull incidents in range with status + timezone
  // and count how many were closed on the same calendar day they were opened.
  let sdQ = supabaseAdmin
    .from('incidents')
    .select('group_id, opened_at, closed_at, status, timezone')
  if (from) sdQ = sdQ.gte('opened_at', from)
  if (to)   sdQ = sdQ.lte('opened_at', to)
  const { data: sdRows } = await sdQ
  const sdByGroup = new Map<number, any[]>()
  for (const r of (sdRows ?? [])) {
    const arr = sdByGroup.get(r.group_id) ?? []
    arr.push(r)
    sdByGroup.set(r.group_id, arr)
  }

  const result: GroupScorecard[] = []
  for (const [gid, rows] of byGroup.entries()) {
    const meta = groupMap.get(gid)
    if (!meta) continue
    const totalMsgs   = rows.reduce((s: number, r: any) => s + (r.total_messages ?? 0), 0)
    const totalIncOpen  = rows.reduce((s: number, r: any) => s + (r.incidents_opened ?? 0), 0)
    const totalIncClose = rows.reduce((s: number, r: any) => s + (r.incidents_closed ?? 0), 0)
    const sentVals    = rows.map((r: any) => r.client_sentiment_avg).filter((v: any) => v != null) as number[]
    const ttfrVals    = rows.map((r: any) => r.avg_ttfr_seconds).filter((v: any) => v != null) as number[]
    const ttrVals     = rows.map((r: any) => r.avg_ttr_seconds).filter((v: any) => v != null) as number[]
    const avgSent     = sentVals.length > 0 ? sentVals.reduce((a, b) => a + b, 0) / sentVals.length : null
    const avgTtfr     = ttfrVals.length > 0 ? ttfrVals.reduce((a, b) => a + b, 0) / ttfrVals.length : null
    const avgTtr      = ttrVals.length  > 0 ? ttrVals.reduce((a, b) => a + b, 0) / ttrVals.length   : null
    const resoRate    = totalIncOpen > 0 ? Math.round((totalIncClose / totalIncOpen) * 100) : null
    const sent010     = avgSent != null ? Math.round(((avgSent + 1) / 2) * 100) / 10 : null
    const ttfrMin     = avgTtfr != null ? Math.round(avgTtfr / 60) : null
    const ttrMin      = avgTtr  != null ? Math.round(avgTtr  / 60) : null

    // Risk: high if sentiment < 5 OR ttfr > 30 OR resolution < 50%
    const risk: 'high' | 'medium' | 'low' =
      (sent010 != null && sent010 < 4) || (ttfrMin != null && ttfrMin > 30) || (resoRate != null && resoRate < 40)
        ? 'high'
        : (sent010 != null && sent010 < 6) || (ttfrMin != null && ttfrMin > 20)
          ? 'medium'
          : 'low'

    const sameDayPct = computeSameDayResolutionPct(sdByGroup.get(gid) ?? [])

    result.push({
      id: gid,
      name: meta.name,
      client_name: meta.client_name,
      country: meta.country,
      vertical: meta.vertical,
      total_messages: totalMsgs,
      open_incidents: openByGroup.get(gid) ?? 0,
      avg_sentiment: sent010,
      avg_ttfr_minutes: ttfrMin,
      avg_ttr_minutes: ttrMin,
      resolution_rate: resoRate,
      same_day_resolution_pct: sameDayPct,
      sla_pct: null, // would need detailed TTFR breakdown
      risk,
    })
  }

  return result.sort((a, b) => {
    const riskOrder = { high: 0, medium: 1, low: 2 }
    return riskOrder[a.risk] - riskOrder[b.risk]
  })
}

// ── Morning Briefing ──────────────────────────────────────────────────────────

export type BriefingHighlight = {
  title: string
  detail: string
  severity: 'info' | 'warning' | 'critical'
}

export type BriefingIncident = {
  group: string
  category: string
  count: number
  trend: 'primera_vez' | 'recurrente' | 'frecuente'
  note: string
}

export type BriefingGroupWatch = {
  group: string
  reason: string
  severity: 'info' | 'warning' | 'critical'
}

export type BriefingChurnSignal = {
  group: string
  quote: string
  context: string
}

export type BriefingAgentRedZone = {
  agent: string
  ttfr_avg_min: number
  incidents: number
}

export type MorningBriefing = {
  id: number
  briefing_date: string
  generated_at: string
  group_id: number | null
  group_name: string | null
  group_country: string | null
  timezone: string | null
  total_messages: number | null
  total_incidents: number | null
  incidents_resolved: number | null
  incidents_escalated: number | null
  avg_ttfr_seconds: number | null
  avg_sentiment: number | null
  headline: string | null
  briefing_markdown: string | null
  briefing: {
    headline: string
    highlights: BriefingHighlight[]
    incidents_summary: BriefingIncident[]
    groups_to_watch: BriefingGroupWatch[]
    trend_note: string
    churn_signals: BriefingChurnSignal[]
    agents_red_zone: BriefingAgentRedZone[]
  }
}

const BRIEFING_SELECT = `
  id, briefing_date, generated_at, group_id, timezone,
  total_messages, total_incidents, incidents_resolved, incidents_escalated,
  avg_ttfr_seconds, avg_sentiment,
  headline, briefing_markdown, briefing_json,
  group:groups!morning_briefings_group_id_fkey(name, country)
`

function rowToBriefing(data: any): MorningBriefing {
  const group = Array.isArray(data?.group) ? data.group[0] : data?.group
  return {
    id: data.id,
    briefing_date: data.briefing_date,
    generated_at: data.generated_at,
    group_id: data.group_id ?? null,
    group_name: group?.name ?? null,
    group_country: group?.country ?? null,
    timezone: data.timezone ?? null,
    total_messages: data.total_messages,
    total_incidents: data.total_incidents,
    incidents_resolved: data.incidents_resolved,
    incidents_escalated: data.incidents_escalated,
    avg_ttfr_seconds: data.avg_ttfr_seconds,
    avg_sentiment: data.avg_sentiment != null ? Number(data.avg_sentiment) : null,
    headline: data.headline,
    briefing_markdown: data.briefing_markdown,
    briefing: data.briefing_json ?? {
      headline: '', highlights: [], incidents_summary: [],
      groups_to_watch: [], trend_note: '', churn_signals: [], agents_red_zone: [],
    },
  }
}

/** Most-recent briefing across all groups (or global). */
export async function getLatestBriefing(): Promise<MorningBriefing | null> {
  const { data, error } = await supabaseAdmin
    .from('morning_briefings')
    .select(BRIEFING_SELECT)
    .order('briefing_date', { ascending: false })
    .order('generated_at',  { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return rowToBriefing(data)
}

/** Latest briefing for a specific group. */
export async function getLatestBriefingForGroup(groupId: number): Promise<MorningBriefing | null> {
  const { data, error } = await supabaseAdmin
    .from('morning_briefings')
    .select(BRIEFING_SELECT)
    .eq('group_id', groupId)
    .order('briefing_date', { ascending: false })
    .order('generated_at',  { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return rowToBriefing(data)
}

/** All per-group briefings for a given date (or, if date omitted, the latest one per group). */
export async function getBriefingsForDate(dateStr?: string): Promise<MorningBriefing[]> {
  let query = supabaseAdmin
    .from('morning_briefings')
    .select(BRIEFING_SELECT)
    .not('group_id', 'is', null)
    .order('briefing_date', { ascending: false })
    .order('generated_at',  { ascending: false })

  if (dateStr) query = query.eq('briefing_date', dateStr)

  const { data } = await query.limit(200)
  const rows = (data ?? []).map(rowToBriefing)

  // If no specific date passed, dedupe to latest per group
  if (!dateStr) {
    const latestByGroup = new Map<number, MorningBriefing>()
    for (const b of rows) {
      if (b.group_id == null) continue
      if (!latestByGroup.has(b.group_id)) latestByGroup.set(b.group_id, b)
    }
    return Array.from(latestByGroup.values())
  }
  return rows
}

/** Single briefing by id (used by the per-group detail page). */
export async function getBriefingById(id: number): Promise<MorningBriefing | null> {
  const { data, error } = await supabaseAdmin
    .from('morning_briefings')
    .select(BRIEFING_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return rowToBriefing(data)
}

/** Briefing for a (group_id, date) pair. */
export async function getBriefingForGroupOnDate(
  groupId: number,
  dateStr?: string,
): Promise<MorningBriefing | null> {
  let q = supabaseAdmin
    .from('morning_briefings')
    .select(BRIEFING_SELECT)
    .eq('group_id', groupId)
    .order('briefing_date', { ascending: false })
    .order('generated_at',  { ascending: false })
  if (dateStr) q = q.eq('briefing_date', dateStr)
  const { data } = await q.limit(1).maybeSingle()
  if (!data) return null
  return rowToBriefing(data)
}

/** Recent global+per-group briefings, used as a date selector. */
export async function getRecentBriefings(limit = 30): Promise<{
  briefing_date: string;
  headline: string | null;
  total_incidents: number | null;
  group_id: number | null;
  group_name: string | null;
}[]> {
  const { data } = await supabaseAdmin
    .from('morning_briefings')
    .select('briefing_date, headline, total_incidents, group_id, group:groups!morning_briefings_group_id_fkey(name)')
    .order('briefing_date', { ascending: false })
    .order('generated_at',  { ascending: false })
    .limit(limit)
  return (data ?? []).map((d: any) => {
    const group = Array.isArray(d.group) ? d.group[0] : d.group
    return {
      briefing_date: d.briefing_date,
      headline: d.headline,
      total_incidents: d.total_incidents,
      group_id: d.group_id ?? null,
      group_name: group?.name ?? null,
    }
  })
}

/** Severity score: more churn signals + critical highlights → higher score. */
export function briefingSeverityScore(b: MorningBriefing): number {
  const churn = b.briefing.churn_signals?.length ?? 0
  const crit = (b.briefing.highlights ?? []).filter((h) => h.severity === 'critical').length
  const warn = (b.briefing.highlights ?? []).filter((h) => h.severity === 'warning').length
  const escalated = b.incidents_escalated ?? 0
  return churn * 100 + crit * 30 + warn * 10 + escalated
}

// ─── Churn risk signals ─────────────────────────────────────────────────────
export type ChurnSeverity = 'threat_to_leave' | 'aggressive_language' | 'service_complaint'
export type ChurnSource = 'keyword' | 'morning_briefing' | 'manual'

export type ChurnSignal = {
  id: number
  group_id: number
  group_name: string | null
  group_country: string | null
  message_id: number | null
  incident_id: number | null
  detected_at: string
  severity: ChurnSeverity
  confidence: number | null
  source: ChurnSource
  quote: string
  context: string | null
  matched_keyword: string | null
  sender_phone: string | null
  sender_display_name: string | null
  sender_role: string | null
  resolved_at: string | null
  resolved_by: string | null
  resolution_note: string | null
  message_timestamp: string | null
}

export const CHURN_SEVERITY_META: Record<ChurnSeverity, { label: string; color: string; bg: string; border: string; rank: number }> = {
  threat_to_leave: {
    label: 'Amenaza de salida',
    color: '#7f1d1d',
    bg: '#fee2e2',
    border: '#fca5a5',
    rank: 3,
  },
  aggressive_language: {
    label: 'Lenguaje agresivo',
    color: '#9a3412',
    bg: '#ffedd5',
    border: '#fdba74',
    rank: 2,
  },
  service_complaint: {
    label: 'Queja de servicio',
    color: '#854d0e',
    bg: '#fef9c3',
    border: '#fde68a',
    rank: 1,
  },
}

export const CHURN_SOURCE_LABEL: Record<ChurnSource, string> = {
  keyword: 'Detección automática',
  morning_briefing: 'Briefing matutino (Sonnet)',
  manual: 'Marcado por agente',
}

const CHURN_SELECT = `
  id, group_id, message_id, incident_id, detected_at,
  severity, confidence, source, quote, context, matched_keyword,
  sender_phone, sender_display_name, sender_role,
  resolved_at, resolved_by, resolution_note,
  group:groups ( name, country ),
  message:messages ( timestamp )
`

function rowToChurnSignal(d: any): ChurnSignal {
  const group = Array.isArray(d.group) ? d.group[0] : d.group
  const msg = Array.isArray(d.message) ? d.message[0] : d.message
  return {
    id: d.id,
    group_id: d.group_id,
    group_name: group?.name ?? null,
    group_country: group?.country ?? null,
    message_id: d.message_id,
    incident_id: d.incident_id,
    detected_at: d.detected_at,
    severity: d.severity,
    confidence: d.confidence,
    source: d.source,
    quote: d.quote,
    context: d.context,
    matched_keyword: d.matched_keyword,
    sender_phone: d.sender_phone,
    sender_display_name: d.sender_display_name,
    sender_role: d.sender_role,
    resolved_at: d.resolved_at,
    resolved_by: d.resolved_by,
    resolution_note: d.resolution_note,
    message_timestamp: msg?.timestamp ?? null,
  }
}

/** All open (unresolved) churn signals, newest first. */
export async function getOpenChurnSignals(opts: { groupId?: number; limit?: number } = {}): Promise<ChurnSignal[]> {
  let q = supabaseAdmin
    .from('churn_signals')
    .select(CHURN_SELECT)
    .is('resolved_at', null)
    .order('detected_at', { ascending: false })
    .limit(opts.limit ?? 100)
  if (opts.groupId) q = q.eq('group_id', opts.groupId)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []).map(rowToChurnSignal)
}

/** All churn signals (open + resolved) for a group, newest first. */
export async function getChurnSignalsForGroup(groupId: number, limit = 30): Promise<ChurnSignal[]> {
  const { data, error } = await supabaseAdmin
    .from('churn_signals')
    .select(CHURN_SELECT)
    .eq('group_id', groupId)
    .order('detected_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map(rowToChurnSignal)
}

/** Churn signals attached to a specific incident (open only). */
export async function getChurnSignalsForIncident(incidentId: number): Promise<ChurnSignal[]> {
  const { data, error } = await supabaseAdmin
    .from('churn_signals')
    .select(CHURN_SELECT)
    .eq('incident_id', incidentId)
    .is('resolved_at', null)
    .order('detected_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(rowToChurnSignal)
}

export type ChurnDailyPoint = { date: string; total: number; threat_to_leave: number; aggressive_language: number; service_complaint: number }

/** Daily counts of new churn signals over the last N days (for analytics chart). */
export async function getChurnDailyTrend(days = 30): Promise<ChurnDailyPoint[]> {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - days)
  const { data, error } = await supabaseAdmin
    .from('churn_signals')
    .select('detected_at, severity')
    .gte('detected_at', since.toISOString())
  if (error) throw error
  const byDay = new Map<string, ChurnDailyPoint>()
  for (let i = 0; i < days; i++) {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - i)
    const key = d.toISOString().slice(0, 10)
    byDay.set(key, { date: key, total: 0, threat_to_leave: 0, aggressive_language: 0, service_complaint: 0 })
  }
  for (const r of data ?? []) {
    const key = (r.detected_at as string).slice(0, 10)
    const slot = byDay.get(key)
    if (!slot) continue
    slot.total += 1
    if (r.severity === 'threat_to_leave') slot.threat_to_leave += 1
    else if (r.severity === 'aggressive_language') slot.aggressive_language += 1
    else if (r.severity === 'service_complaint') slot.service_complaint += 1
  }
  return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date))
}

/** Counts of currently-open signals, broken down by severity (portfolio-wide). */
export async function getChurnOpenCounts(): Promise<{ total: number; threat_to_leave: number; aggressive_language: number; service_complaint: number; groups_affected: number }> {
  const { data, error } = await supabaseAdmin
    .from('churn_signals')
    .select('severity, group_id')
    .is('resolved_at', null)
  if (error) throw error
  const counts = { total: 0, threat_to_leave: 0, aggressive_language: 0, service_complaint: 0, groups_affected: 0 }
  const groups = new Set<number>()
  for (const r of data ?? []) {
    counts.total += 1
    if (r.severity === 'threat_to_leave') counts.threat_to_leave += 1
    else if (r.severity === 'aggressive_language') counts.aggressive_language += 1
    else if (r.severity === 'service_complaint') counts.service_complaint += 1
    groups.add(r.group_id as number)
  }
  counts.groups_affected = groups.size
  return counts
}

/** Mark a signal as resolved (used by the dashboard "ack" action). */
export async function resolveChurnSignal(signalId: number, note?: string, resolvedBy = 'dashboard'): Promise<void> {
  const { error } = await supabaseAdmin
    .from('churn_signals')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy,
      resolution_note: note ?? null,
    })
    .eq('id', signalId)
  if (error) throw error
}

/** Sort helper: severity rank desc, then detected_at desc. */
export function churnSeveritySort(a: ChurnSignal, b: ChurnSignal): number {
  const da = CHURN_SEVERITY_META[a.severity].rank
  const db = CHURN_SEVERITY_META[b.severity].rank
  if (db !== da) return db - da
  return (b.detected_at ?? '').localeCompare(a.detected_at ?? '')
}

// ─── TTFR by incident category ──────────────────────────────────────────────
// Per-category breakdown of how fast we're answering each kind of problem.
// Surfaces in /analytics so account managers can spot which categories drag
// the SLA down (e.g. problema_sistema is slow but rare; problema_horario
// is fast and high-volume).
export type TtfrByCategoryRow = {
  category: string
  label: string
  count: number
  pct: number              // share of total incidents in window
  avg_ttfr_min: number | null
  p50_ttfr_min: number | null
  p90_ttfr_min: number | null
  avg_ttr_min:  number | null  // time-to-resolution
  resolution_rate: number      // 0..100, % closed
  escalated: number
  open: number
  urgency_alta: number
  urgency_media: number
  urgency_baja: number
}

function _percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))
  return sorted[idx]
}

export async function getTtfrByCategory(
  from: string | Date | null,
  to: string | Date | null,
  groupId: number | null = null,
): Promise<TtfrByCategoryRow[]> {
  const fromIso = from instanceof Date ? from.toISOString() : from
  // For date-only strings (YYYY-MM-DD), include the full "to" day by appending 23:59:59.
  const toIso = to instanceof Date
    ? to.toISOString()
    : to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59` : to
  let q = supabaseAdmin
    .from('incidents')
    .select('category, urgency, ttfr_seconds, ttr_seconds, closed_at, escalated_at, is_open')
    .not('category', 'is', null)
  if (fromIso) q = q.gte('opened_at', fromIso)
  if (toIso)   q = q.lte('opened_at', toIso)
  if (groupId) q = q.eq('group_id', groupId)

  const { data, error } = await q
  if (error || !data) return []

  type Bucket = {
    count: number; alta: number; media: number; baja: number
    ttfrs: number[]; ttrs: number[]
    resolved: number; escalated: number; open: number
  }
  const map: Record<string, Bucket> = {}

  for (const row of data as any[]) {
    const cat = row.category as string
    if (!map[cat]) {
      map[cat] = { count: 0, alta: 0, media: 0, baja: 0, ttfrs: [], ttrs: [], resolved: 0, escalated: 0, open: 0 }
    }
    const b = map[cat]
    b.count++
    if (row.urgency === 'alta')  b.alta++
    if (row.urgency === 'media') b.media++
    if (row.urgency === 'baja')  b.baja++
    // TTFR/TTR (horario laboral) — sólo acumulamos si el ticket cerró, para
    // mantener los promedios de TTFR y TTR sobre la misma población.
    if (row.closed_at != null) {
      if (row.ttfr_seconds != null) b.ttfrs.push(row.ttfr_seconds)
      if (row.ttr_seconds  != null) b.ttrs.push(row.ttr_seconds)
      b.resolved++
    }
    if (row.escalated_at != null) b.escalated++
    if (row.is_open === true)     b.open++
  }

  const total = Object.values(map).reduce((s, v) => s + v.count, 0)
  if (total === 0) return []

  return Object.entries(map)
    .map(([cat, v]) => {
      const ttfrSorted = [...v.ttfrs].sort((a, b) => a - b)
      const ttrSorted  = [...v.ttrs].sort((a, b) => a - b)
      const avg = (arr: number[]) => arr.length === 0 ? null : Math.round(arr.reduce((s, x) => s + x, 0) / arr.length / 60)
      return {
        category:        cat,
        label:           CATEGORY_ES[cat] ?? cat.replace(/_/g, ' '),
        count:           v.count,
        pct:             Math.round((v.count / total) * 1000) / 10,
        avg_ttfr_min:    avg(v.ttfrs),
        p50_ttfr_min:    ttfrSorted.length ? Math.round((_percentile(ttfrSorted, 0.50) ?? 0) / 60) : null,
        p90_ttfr_min:    ttfrSorted.length ? Math.round((_percentile(ttfrSorted, 0.90) ?? 0) / 60) : null,
        avg_ttr_min:     avg(v.ttrs),
        resolution_rate: v.count > 0 ? Math.round((v.resolved / v.count) * 100) : 0,
        escalated:       v.escalated,
        open:            v.open,
        urgency_alta:    v.alta,
        urgency_media:   v.media,
        urgency_baja:    v.baja,
      } satisfies TtfrByCategoryRow
    })
    .sort((a, b) => b.count - a.count)
}

// ─── Classification feedback (T07) ──────────────────────────────────────────
// Human-in-the-loop corrections to Sonnet classification on incidents.
// Each row in classification_feedback represents one field-level override.

export type FeedbackField = 'category' | 'urgency' | 'sentiment' | 'bucket' | 'summary' | 'other'

export const FEEDBACK_FIELD_LABEL: Record<FeedbackField, string> = {
  category:  'Categoría',
  urgency:   'Urgencia',
  sentiment: 'Sentimiento',
  bucket:    'Bucket',
  summary:   'Resumen',
  other:     'Otro',
}

export type ClassificationFeedback = {
  id:           number
  incident_id:  number | null
  message_id:   number | null
  field:        FeedbackField
  old_value:    string | null
  new_value:    string | null
  reason:       string | null
  submitted_by: string
  source:       string
  applied:      boolean
  submitted_at: string
}

export async function listFeedbackForIncident(
  incidentId: number,
  limit = 50,
): Promise<ClassificationFeedback[]> {
  const { data, error } = await supabaseAdmin
    .from('classification_feedback')
    .select('id, incident_id, message_id, field, old_value, new_value, reason, submitted_by, source, applied, submitted_at')
    .eq('incident_id', incidentId)
    .order('submitted_at', { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return data as ClassificationFeedback[]
}

export async function listRecentFeedback(limit = 20): Promise<ClassificationFeedback[]> {
  const { data, error } = await supabaseAdmin
    .from('classification_feedback')
    .select('id, incident_id, message_id, field, old_value, new_value, reason, submitted_by, source, applied, submitted_at')
    .order('submitted_at', { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return data as ClassificationFeedback[]
}

export type FeedbackCounts = {
  total: number
  by_field: Record<FeedbackField, number>
  unique_incidents: number
  last_submitted_at: string | null
}

export async function getFeedbackCounts(days = 30): Promise<FeedbackCounts> {
  const since = new Date()
  since.setDate(since.getDate() - days)
  const { data, error } = await supabaseAdmin
    .from('classification_feedback')
    .select('field, incident_id, submitted_at')
    .gte('submitted_at', since.toISOString())
    .order('submitted_at', { ascending: false })
  const empty: FeedbackCounts = {
    total: 0,
    by_field: { category: 0, urgency: 0, sentiment: 0, bucket: 0, summary: 0, other: 0 },
    unique_incidents: 0,
    last_submitted_at: null,
  }
  if (error || !data) return empty
  const out: FeedbackCounts = { ...empty, by_field: { ...empty.by_field } }
  const incidents = new Set<number>()
  for (const row of data as any[]) {
    out.total++
    const f = row.field as FeedbackField
    if (f in out.by_field) out.by_field[f]++
    if (row.incident_id) incidents.add(row.incident_id)
    if (!out.last_submitted_at || row.submitted_at > out.last_submitted_at) {
      out.last_submitted_at = row.submitted_at
    }
  }
  out.unique_incidents = incidents.size
  return out
}

/** Insert one feedback row + (best-effort) apply override on the source row. */
export async function recordIncidentFeedback(opts: {
  incidentId:   number
  field:        FeedbackField
  oldValue:     string | null
  newValue:     string | null
  reason:       string | null
  submittedBy?: string
}): Promise<{ id: number; applied: boolean } | null> {
  const submittedBy = opts.submittedBy ?? 'dashboard'

  // 1) Try to apply the override on incidents (when field maps to a real column).
  let applied = false
  if (opts.field === 'category' || opts.field === 'urgency' || opts.field === 'summary') {
    const updates: Record<string, any> = {}
    updates[opts.field] = opts.newValue
    const { error } = await supabaseAdmin
      .from('incidents')
      .update(updates)
      .eq('id', opts.incidentId)
    applied = !error
  } else if (opts.field === 'sentiment') {
    const num = opts.newValue == null ? null : Number(opts.newValue)
    if (num != null && Number.isFinite(num)) {
      const { error } = await supabaseAdmin
        .from('incidents')
        .update({ sentiment_avg: num })
        .eq('id', opts.incidentId)
      applied = !error
    }
  }
  // 'bucket' and 'other' are logged-only (bucket lives on analysis rows per-message).

  // 2) Always write the audit row, even if the override didn't land.
  const { data, error } = await supabaseAdmin
    .from('classification_feedback')
    .insert({
      incident_id:  opts.incidentId,
      field:        opts.field,
      old_value:    opts.oldValue,
      new_value:    opts.newValue,
      reason:       opts.reason,
      submitted_by: submittedBy,
      source:       'dashboard',
      applied,
    })
    .select('id, applied')
    .single()

  if (error || !data) return null
  return { id: (data as any).id, applied: (data as any).applied }
}

// ─── Multi-week trend (T08) ─────────────────────────────────────────────────
// Aggregates group_kpi_snapshots into ISO-week buckets so Account Managers can
// see 4/8/12-week rolling trends on Analytics and per-group pages.
//
// Week start: Monday (matches Postgres default DATE_TRUNC('week')).
// Each bucket carries: messages, incidents (opened/closed/resolution_rate),
// sentiment (0-10 scale), avg TTFR (minutes), and how many distinct days had
// snapshot data so we can show coverage % when the data is sparse.

export type WeeklyTrendPoint = {
  week_start:        string  // 'YYYY-MM-DD' (Monday)
  week_label:        string  // 'Sem 17 · 21–27 abr'
  days_with_data:    number  // 0..7
  messages:          number
  incidents_opened:  number
  incidents_closed:  number
  resolution_rate:   number | null  // 0..100
  bucket_a:          number
  bucket_b:          number
  bucket_c:          number
  noise_pct:         number | null  // bucket_c / total_messages * 100
  sentiment:         number | null  // 0..10
  avg_ttfr_minutes:  number | null  // time to first response
  p90_ttfr_minutes:  number | null
  avg_ttr_minutes:   number | null  // time to resolution (full ticket lifecycle)
}

function _isoWeekNum(date: Date): number {
  // ISO-8601 week number (Monday-based, Jan 4 always in week 1).
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const diff = d.getTime() - firstThursday.getTime()
  return 1 + Math.round(diff / (7 * 86_400_000))
}

function _mondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = (d.getUTCDay() + 6) % 7  // Mon=0, Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum)
  return d
}

function _formatWeekLabel(monday: Date): string {
  const sunday = new Date(monday)
  sunday.setUTCDate(sunday.getUTCDate() + 6)
  const w = _isoWeekNum(monday)
  const ML = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  const m1 = ML[monday.getUTCMonth()]
  const m2 = ML[sunday.getUTCMonth()]
  return m1 === m2
    ? `Sem ${w} · ${monday.getUTCDate()}–${sunday.getUTCDate()} ${m1}`
    : `Sem ${w} · ${monday.getUTCDate()} ${m1}–${sunday.getUTCDate()} ${m2}`
}

/**
 * Get per-week aggregated KPIs for the last `weeks` ISO weeks (Monday-based).
 *
 * Always returns exactly `weeks` entries, oldest first; weeks with no data
 * still appear with zeros / nulls so the chart axes stay stable.
 */
export async function getMultiWeekTrend(
  weeks: number = 8,
  groupId: number | null = null,
): Promise<WeeklyTrendPoint[]> {
  const wantedWeeks = Math.max(1, Math.min(weeks, 26))

  // Build the rolling window: oldest Monday → today.
  const today    = new Date()
  const lastMon  = _mondayOf(today)
  const firstMon = new Date(lastMon)
  firstMon.setUTCDate(firstMon.getUTCDate() - 7 * (wantedWeeks - 1))
  const fromIso  = firstMon.toISOString().slice(0, 10)

  let q = supabaseAdmin
    .from('group_kpi_snapshots')
    .select(`
      snapshot_date,
      group_id,
      total_messages, bucket_a, bucket_b, bucket_c,
      incidents_opened, incidents_closed,
      avg_ttfr_seconds, p90_ttfr_seconds, avg_ttr_seconds,
      client_sentiment_avg
    `)
    .gte('snapshot_date', fromIso)
    .order('snapshot_date', { ascending: true })

  if (groupId) q = q.eq('group_id', groupId)
  const { data, error } = await q
  const rows = error || !data ? [] : (data as any[])

  // Pre-build the empty bucket map so missing weeks still show up.
  type Bucket = {
    monday: Date
    days: Set<string>
    messages: number
    bucket_a: number
    bucket_b: number
    bucket_c: number
    incidents_opened: number
    incidents_closed: number
    ttfr_avg_sec: number[]   // for averaging
    p90_ttfr_sec: number[]
    ttr_avg_sec:  number[]
    sentiments:   number[]
  }
  const buckets = new Map<string, Bucket>()
  for (let i = 0; i < wantedWeeks; i++) {
    const monday = new Date(firstMon)
    monday.setUTCDate(monday.getUTCDate() + i * 7)
    const key = monday.toISOString().slice(0, 10)
    buckets.set(key, {
      monday,
      days: new Set(),
      messages: 0, bucket_a: 0, bucket_b: 0, bucket_c: 0,
      incidents_opened: 0, incidents_closed: 0,
      ttfr_avg_sec: [], p90_ttfr_sec: [], ttr_avg_sec: [], sentiments: [],
    })
  }

  for (const r of rows) {
    const date = String(r.snapshot_date).slice(0, 10)
    const monday = _mondayOf(new Date(date + 'T00:00:00Z'))
    const key = monday.toISOString().slice(0, 10)
    const b = buckets.get(key)
    if (!b) continue  // outside the window
    b.days.add(date)
    b.messages         += r.total_messages    ?? 0
    b.bucket_a         += r.bucket_a          ?? 0
    b.bucket_b         += r.bucket_b          ?? 0
    b.bucket_c         += r.bucket_c          ?? 0
    b.incidents_opened += r.incidents_opened  ?? 0
    b.incidents_closed += r.incidents_closed  ?? 0
    if (r.avg_ttfr_seconds  != null) b.ttfr_avg_sec.push(Number(r.avg_ttfr_seconds))
    if (r.p90_ttfr_seconds  != null) b.p90_ttfr_sec.push(Number(r.p90_ttfr_seconds))
    if (r.avg_ttr_seconds   != null) b.ttr_avg_sec.push(Number(r.avg_ttr_seconds))
    if (r.client_sentiment_avg != null) b.sentiments.push(Number(r.client_sentiment_avg))
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length

  return [...buckets.values()].map((b) => {
    const sentRaw = avg(b.sentiments)
    const ttfrSec = avg(b.ttfr_avg_sec)
    const p90Sec  = avg(b.p90_ttfr_sec)
    const ttrSec  = avg(b.ttr_avg_sec)
    return {
      week_start:        b.monday.toISOString().slice(0, 10),
      week_label:        _formatWeekLabel(b.monday),
      days_with_data:    b.days.size,
      messages:          b.messages,
      incidents_opened:  b.incidents_opened,
      incidents_closed:  b.incidents_closed,
      resolution_rate:   b.incidents_opened > 0
        ? Math.round((b.incidents_closed / b.incidents_opened) * 100)
        : null,
      bucket_a:          b.bucket_a,
      bucket_b:          b.bucket_b,
      bucket_c:          b.bucket_c,
      noise_pct:         b.messages > 0
        ? Math.round((b.bucket_c / b.messages) * 100)
        : null,
      sentiment:         sentRaw != null
        ? Math.round(((sentRaw + 1) / 2) * 100) / 10  // -1..1 → 0..10
        : null,
      avg_ttfr_minutes:  ttfrSec != null ? Math.round(ttfrSec / 60) : null,
      p90_ttfr_minutes:  p90Sec  != null ? Math.round(p90Sec  / 60) : null,
      avg_ttr_minutes:   ttrSec  != null ? Math.round(ttrSec  / 60) : null,
    } satisfies WeeklyTrendPoint
  })
}
