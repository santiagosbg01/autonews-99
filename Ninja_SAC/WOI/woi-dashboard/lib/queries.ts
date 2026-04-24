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
  last_message_at: string | null
}

export type GroupDetail = {
  id: number
  name: string
  whatsapp_id: string
  pilot_cohort: string
  timezone: string
  notes: string | null
  joined_at: string
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

export type TicketStatus = 'abierto' | 'respondido' | 'resuelto' | 'escalado' | 'pendiente'

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
  abierto:    { label: 'Abierto',    color: '#f59e0b', bg: '#fffbeb', dot: '●' },
  respondido: { label: 'Respondido', color: '#3b82f6', bg: '#eff6ff', dot: '●' },
  pendiente:  { label: 'Pendiente',  color: '#f97316', bg: '#fff7ed', dot: '◌' },
  escalado:   { label: 'Escalado',   color: '#ef4444', bg: '#fef2f2', dot: '▲' },
  resuelto:   { label: 'Resuelto',   color: '#10b981', bg: '#f0fdf4', dot: '✓' },
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
        { data: lastMsg },
        { data: ttfrData },
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
        supabaseAdmin.from('messages').select('timestamp')
          .eq('group_id', g.id).order('timestamp', { ascending: false }).limit(1),
        supabaseAdmin.from('incidents').select('ttfr_seconds')
          .eq('group_id', g.id).gte('opened_at', startOfWeek.toISOString())
          .not('ttfr_seconds', 'is', null),
      ])

      const analyses = (analysisToday ?? []).map((m: any) => m.analysis).filter(Boolean)
      const bucket_b_today = analyses.filter((a: any) => a.bucket === 'B').length
      const sentiments = analyses.map((a: any) => a.sentiment).filter((s: any) => s !== null)
      const avg_sentiment = sentiments.length > 0
        ? sentiments.reduce((a: number, b: number) => a + b, 0) / sentiments.length
        : null

      const ttfrs = (ttfrData ?? []).map((i: any) => i.ttfr_seconds).filter((s: any) => s !== null)
      const avg_ttfr_minutes = ttfrs.length > 0
        ? Math.round(ttfrs.reduce((a: number, b: number) => a + b, 0) / ttfrs.length / 60)
        : null

      return {
        ...g,
        messages_today: messages_today ?? 0,
        messages_week: messages_week ?? 0,
        open_incidents: open_incidents ?? 0,
        bucket_b_today,
        avg_sentiment,
        avg_ttfr_minutes,
        last_message_at: lastMsg?.[0]?.timestamp ?? null,
      }
    })
  )

  return summaries
}

export async function getGroupDetail(id: number): Promise<GroupDetail | null> {
  const { data, error } = await supabaseAdmin
    .from('groups')
    .select('id, name, whatsapp_id, pilot_cohort, timezone, notes, joined_at')
    .eq('id', id)
    .single()
  if (error) return null
  return data
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

const INCIDENT_FIELDS = 'id, opened_at, closed_at, category, urgency, is_open, status, message_count, ttfr_seconds, ttr_seconds, owner_phone, summary, first_response_at, first_response_by, sentiment_avg, escalated_at, escalated_reason'

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
  haiku_consistency_pct: number | null
  generated_at: string
}

export async function getDailyReports(limit = 14): Promise<DailyReport[]> {
  const { data, error } = await supabaseAdmin
    .from('daily_reports')
    .select('id, report_date, total_messages, bucket_a_count, bucket_b_count, bucket_c_count, ratio_b, incidents_opened, incidents_closed, avg_ttfr_seconds, sonnet_narrative, haiku_consistency_pct, generated_at')
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
}

export async function getIncidentCategoryBreakdown(days = 30): Promise<CategoryBreakdownItem[]> {
  const since = new Date()
  since.setDate(since.getDate() - days)

  const { data, error } = await supabaseAdmin
    .from('incidents')
    .select('category, urgency, ttfr_seconds')
    .gte('opened_at', since.toISOString())
    .not('category', 'is', null)

  if (error || !data) return []

  const map: Record<string, { count: number; alta: number; media: number; baja: number; ttfrs: number[] }> = {}

  for (const row of data as any[]) {
    const cat = row.category as string
    if (!map[cat]) map[cat] = { count: 0, alta: 0, media: 0, baja: 0, ttfrs: [] }
    map[cat].count++
    if (row.urgency === 'alta')  map[cat].alta++
    if (row.urgency === 'media') map[cat].media++
    if (row.urgency === 'baja')  map[cat].baja++
    if (row.ttfr_seconds != null) map[cat].ttfrs.push(row.ttfr_seconds)
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
  avg_ttfr_minutes: number | null
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

  // 3. Incidents opened in range
  let incQ = supabaseAdmin.from('incidents').select('id, ttfr_seconds', { count: 'exact' })
  if (f) incQ = incQ.gte('opened_at', f.toISOString())
  if (t) incQ = incQ.lte('opened_at', t.toISOString())
  const { data: incData, count: incCount } = await incQ

  // 4. Avg TTFR from incidents in range
  const ttfrs = (incData ?? []).map((r: any) => r.ttfr_seconds).filter((v: any) => v != null) as number[]
  const avgTtfr = ttfrs.length > 0
    ? Math.round(ttfrs.reduce((a, b) => a + b, 0) / ttfrs.length / 60)
    : null

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
    total_groups:       groupCount ?? 0,
    messages_in_range:  msgCount   ?? 0,
    incidents_in_range: incCount   ?? 0,
    avg_sentiment_010:  avgSentiment010,
    avg_ttfr_minutes:   avgTtfr,
    range_label:        rangeLabels[range] ?? range,
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
