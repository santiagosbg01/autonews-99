import {
  getAgentLeaderboard,
  getOpenIncidents,
  getDailyReports,
  getIncidentCategoryBreakdown,
  getAnalyticsTimeSeries,
  getGroupScorecard,
  getChurnOpenCounts,
  getChurnDailyTrend,
  getPortfolioMessageMix,
  getTtfrByCategory,
  getAgentAnalysis,
  getFeedbackCounts,
  getMultiWeekTrend,
  getSameDayResolutionPct,
  getGroupsSummary,
  getGlobalKPIs,
  getBriefingsForDate,
  briefingSeverityScore,
  getOpenChurnSignals,
  FEEDBACK_FIELD_LABEL,
  MIX_META,
  CATEGORY_ES,
  type RangeKey,
} from '@/lib/queries'
import Link from 'next/link'
import { Suspense } from 'react'
import AnalyticsFilters from '@/app/components/AnalyticsFilters'
import AnalyticsCharts from '@/app/components/AnalyticsCharts'
import ChurnAnalyticsCard from '@/app/components/ChurnAnalyticsCard'
import TtfrByCategoryCard from '@/app/components/TtfrByCategoryCard'
import AgentLeaderboardCard from '@/app/components/AgentLeaderboardCard'
import MultiWeekTrendCard from '@/app/components/MultiWeekTrendCard'
import DateRangeFilter from '@/app/components/DateRangeFilter'
import ChurnAlertBanner from '@/app/components/ChurnAlertBanner'

export const dynamic = 'force-dynamic'

// Tipificación de incidencias = problem categories
const PROBLEM_CATEGORIES = new Set([
  'problema_unidad','problema_horario','problema_entrada','problema_salida',
  'problema_trafico','problema_manifestacion','robo_incidencia',
  'problema_sistema','problema_proveedor',
])

const BUCKET_COLORS: Record<string, string> = {
  problema_unidad:        '#ef4444',
  problema_horario:       '#f97316',
  problema_entrada:       '#f59e0b',
  problema_salida:        '#eab308',
  problema_trafico:       '#84cc16',
  problema_manifestacion: '#06b6d4',
  robo_incidencia:        '#8b5cf6',
  problema_sistema:       '#ec4899',
  problema_proveedor:     '#6366f1',
  confirmacion_resolucion:'#10b981',
  reporte_entrega:        '#10b981',
  confirmacion_llegada:   '#22c55e',
  confirmacion_salida:    '#22c55e',
  acuse_recibo:           '#94a3b8',
  consulta_info:          '#64748b',
  saludo_ruido:           '#cbd5e1',
  otro:                   '#e2e8f0',
}

function formatMinutes(seconds: number | null) {
  if (seconds === null) return '—'
  const m = Math.round(seconds / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

// ── feedback KPI helpers ────────────────────────────────────────────────────
const feedbackLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: '#64748b',
}
const feedbackValue: React.CSSProperties = {
  fontSize: 22, fontWeight: 800, lineHeight: 1.05, color: '#0f172a',
}
const feedbackHint: React.CSSProperties = {
  fontSize: 11, color: '#64748b',
}
function feedbackKpi(color: string, bg: string, border: string): React.CSSProperties {
  return {
    background: bg,
    border: `1px solid ${border}`,
    borderLeft: `3px solid ${color}`,
    borderRadius: 8,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  }
}

function SentimentDot({ val }: { val: number | null }) {
  if (val === null) return <span style={{ color: '#94a3b8' }}>—</span>
  const color = val >= 7 ? '#10b981' : val >= 5 ? '#f59e0b' : '#ef4444'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontWeight: 700, color,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {val.toFixed(1)}
    </span>
  )
}

function TtfrBadge({ min }: { min: number | null }) {
  if (min === null) return <span style={{ color: '#94a3b8' }}>—</span>
  const color = min > 30 ? '#ef4444' : min > 15 ? '#f59e0b' : '#10b981'
  const bg    = min > 30 ? '#fef2f2' : min > 15 ? '#fffbeb' : '#f0fdf4'
  const label = min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`
  return (
    <span title="Tiempo a primera respuesta" style={{ color, background: bg, padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
      {label}
    </span>
  )
}

function TtrBadge({ min }: { min: number | null }) {
  if (min === null) return <span style={{ color: '#94a3b8' }}>—</span>
  // TTR threshold: ≤90m great · ≤240m attention · >240m critical
  const color = min > 240 ? '#ef4444' : min > 90 ? '#f59e0b' : '#10b981'
  const bg    = min > 240 ? '#fef2f2' : min > 90 ? '#fffbeb' : '#f0fdf4'
  const label = min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`
  return (
    <span title="Tiempo total a resolución" style={{ color, background: bg, padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
      {label}
    </span>
  )
}

function RiskBadge({ risk }: { risk: 'high' | 'medium' | 'low' }) {
  const map = {
    high:   { label: '⚠️ Alto',  color: '#ef4444', bg: '#fef2f2' },
    medium: { label: '⚡ Medio', color: '#f59e0b', bg: '#fffbeb' },
    low:    { label: '✓ OK',     color: '#10b981', bg: '#f0fdf4' },
  }
  const m = map[risk]
  return (
    <span style={{ color: m.color, background: m.bg, padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
      {m.label}
    </span>
  )
}

function resolveDates(period: string): { from: string; to: string } {
  const now  = new Date()
  const to   = now.toISOString().split('T')[0]
  if (period === 'todos') return { from: '2024-01-01', to }
  const days = parseInt(period)
  const from = new Date(now)
  from.setDate(from.getDate() - days)
  return { from: from.toISOString().split('T')[0], to }
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const sp      = await searchParams
  const period  = sp.period  ?? '30d'
  const groupId = sp.group   ? parseInt(sp.group) : null
  const days    = parseInt(period) || 30

  // Executive KPI strip / briefing banner range (independent from the
  // chart-period filter — drives only the top section).
  const range  = (sp.range ?? 'hoy') as RangeKey
  const kpiFrom = sp.from
  const kpiTo   = sp.to

  // Multi-week trend lives on its own selector; defaults to 8w.
  const weeksRaw = sp.weeks ? parseInt(sp.weeks) : 8
  const weeks    = [4, 8, 12].includes(weeksRaw) ? weeksRaw : 8

  const { from, to } = resolveDates(period)

  const [
    agents, openIncidents, dailyReports, categoryBreakdown, timeSeries, scorecard,
    churnCounts, churnTrend, portfolioMix, ttfrByCategory, agentAnalysis, feedbackCounts,
    weeklyTrend, sameDay,
    // Executive top-section data
    groupsSummary, kpis, briefings, churnTop,
  ] = await Promise.all([
    getAgentLeaderboard(),
    getOpenIncidents(),
    getDailyReports(14),
    getIncidentCategoryBreakdown(days),
    getAnalyticsTimeSeries(from, to, groupId),
    getGroupScorecard(from, to),
    getChurnOpenCounts(),
    getChurnDailyTrend(Math.min(days, 30)),
    getPortfolioMessageMix(Math.min(days, 30)),
    getTtfrByCategory(from, to, groupId),
    getAgentAnalysis(from, to, groupId),
    getFeedbackCounts(Math.min(days, 90)),
    getMultiWeekTrend(weeks, groupId),
    getSameDayResolutionPct(from, to, groupId),
    getGroupsSummary(),
    getGlobalKPIs(range, kpiFrom, kpiTo),
    getBriefingsForDate(),
    getOpenChurnSignals({ limit: 5 }),
  ])

  // ── Executive section computed values (moved from /grupos) ─────────────────
  const topBriefing = briefings.length
    ? [...briefings].sort((a, b) => briefingSeverityScore(b) - briefingSeverityScore(a))[0]
    : null
  const groupsWithChurn   = briefings.filter(b => (b.briefing.churn_signals?.length ?? 0) > 0).length
  const totalChurnSignals = briefings.reduce((acc, b) => acc + (b.briefing.churn_signals?.length ?? 0), 0)

  const portfolioHealth = groupsSummary.length
    ? Math.round(groupsSummary.reduce((acc, g) => acc + g.health.total, 0) / groupsSummary.length)
    : null
  const groupsCritical = groupsSummary.filter(g => g.health.band === 'critical').length
  const groupsWarning  = groupsSummary.filter(g => g.health.band === 'warning').length
  const portfolioColor = portfolioHealth == null ? 'var(--text-muted)'
    : portfolioHealth >= 80 ? 'var(--success)'
    : portfolioHealth >= 70 ? '#0369a1'
    : portfolioHealth >= 55 ? 'var(--warning)' : 'var(--danger)'

  const sentimentColor = kpis.avg_sentiment_010 == null ? 'var(--text-muted)'
    : kpis.avg_sentiment_010 >= 7 ? 'var(--success)'
    : kpis.avg_sentiment_010 >= 5 ? 'var(--warning)'
    : 'var(--danger)'
  const ttfrExecColor = kpis.avg_ttfr_minutes == null ? 'var(--text-muted)'
    : kpis.avg_ttfr_minutes > 30 ? 'var(--danger)' : 'var(--success)'
  const ttrExecColor  = kpis.avg_ttr_minutes == null ? 'var(--text-muted)'
    : kpis.avg_ttr_minutes > 240 ? 'var(--danger)'
    : kpis.avg_ttr_minutes > 90  ? 'var(--warning)' : 'var(--success)'
  const fmtMinExec = (v: number | null) =>
    v == null ? '—' : v < 60 ? `${v} min` : `${Math.floor(v / 60)}h ${v % 60}m`

  // Fetch groups list for the filter dropdown
  const { supabaseAdmin } = await import('@/lib/supabase')
  const { data: groupsRaw } = await supabaseAdmin
    .from('groups')
    .select('id, name')
    .eq('is_active', true)
    .order('name')
  const groups = (groupsRaw ?? []) as { id: number; name: string }[]

  const problems      = categoryBreakdown.filter(c => PROBLEM_CATEGORIES.has(c.category))
  const operations    = categoryBreakdown.filter(c => !PROBLEM_CATEGORIES.has(c.category))
  const totalProblems = problems.reduce((s, c) => s + c.count, 0)
  const totalAll      = categoryBreakdown.reduce((s, c) => s + c.count, 0)

  const totalOpen  = openIncidents.length
  const altaCount  = openIncidents.filter(i => i.urgency === 'alta').length
  const avgTtfr    = agents.length > 0
    ? agents.filter(a => a.avg_ttfr_minutes !== null).reduce((s, a) => s + (a.avg_ttfr_minutes ?? 0), 0)
      / (agents.filter(a => a.avg_ttfr_minutes !== null).length || 1)
    : null
  // Avg TTR over the period (full ticket resolution time)
  const ttrPts = timeSeries.filter(d => d.ttr_minutes != null)
  const avgTtr = ttrPts.length > 0
    ? ttrPts.reduce((s, d) => s + (d.ttr_minutes ?? 0), 0) / ttrPts.length
    : null
  const slaOk = timeSeries.filter(d => d.ttfr_minutes != null && d.ttfr_minutes <= 15).length
  const slaPct = timeSeries.filter(d => d.ttfr_minutes != null).length > 0
    ? Math.round(slaOk / timeSeries.filter(d => d.ttfr_minutes != null).length * 100)
    : null

  const fmtMin = (v: number | null) =>
    v == null ? '—' : v < 60 ? `${Math.round(v)}m` : `${Math.floor(v / 60)}h ${Math.round(v) % 60}m`

  const periodLabel: Record<string, string> = {
    '7d': 'últimos 7 días', '30d': 'últimos 30 días', '90d': 'últimos 90 días', todos: 'todo el tiempo',
  }

  return (
    <div style={{ paddingBottom: 80 }}>

      {/* ════════════════════════════════════════════════════════════════════
          EXECUTIVE OVERVIEW — top of the page.
          Briefing banner + range filter + portfolio KPIs.
          (Moved from the legacy /grupos landing page on 2026-04-25.)
      ════════════════════════════════════════════════════════════════════ */}

      {/* Morning Briefings — multi-group summary banner */}
      {briefings.length > 0 && (
        <Link
          href="/briefing"
          style={{ textDecoration: 'none', color: 'inherit', display: 'block', marginBottom: 18 }}
        >
          <div style={{
            background: groupsWithChurn > 0
              ? 'linear-gradient(135deg, #fef2f2 0%, #fff7ed 100%)'
              : 'linear-gradient(135deg, #f0fdf4 0%, #ecfeff 100%)',
            border: `1px solid ${groupsWithChurn > 0 ? '#fecaca' : '#bbf7d0'}`,
            borderRadius: 14,
            padding: '18px 22px',
            cursor: 'pointer',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16,
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: '#16a34a',
                  background: '#dcfce7', padding: '3px 10px', borderRadius: 999, letterSpacing: '0.05em',
                }}>
                  MORNING BRIEFINGS
                </span>
                <span style={{ fontSize: 11, color: '#475569', fontWeight: 500 }}>
                  {briefings.length} {briefings.length === 1 ? 'grupo' : 'grupos'} · 6 am hora local
                </span>
                {groupsWithChurn > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: '#dc2626',
                    background: '#fee2e2', padding: '3px 10px', borderRadius: 999, letterSpacing: '0.05em',
                  }}>
                    {totalChurnSignals} CHURN SIGNAL{totalChurnSignals > 1 ? 'S' : ''} EN {groupsWithChurn} {groupsWithChurn === 1 ? 'GRUPO' : 'GRUPOS'}
                  </span>
                )}
              </div>
              {topBriefing?.headline && (
                <>
                  <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, marginBottom: 2 }}>
                    Top priority — {topBriefing.group_name}
                  </div>
                  <p style={{
                    fontSize: 14, fontWeight: 600, color: '#0f172a', margin: 0, lineHeight: 1.5,
                    overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  }}>
                    {topBriefing.headline}
                  </p>
                </>
              )}
            </div>
            <div style={{
              fontSize: 12, fontWeight: 700, color: '#16a34a',
              whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4,
            }}>
              Ver todos →
            </div>
          </div>
        </Link>
      )}

      {/* Churn-risk banner (top-5 most recent open signals) */}
      {churnTop.length > 0 && (
        <ChurnAlertBanner signals={churnTop} variant="banner" collapsedByDefault />
      )}

      {/* Date range filter — drives the executive KPI strip below */}
      <Suspense>
        <DateRangeFilter />
      </Suspense>

      {/* Executive KPI cards — portfolio health + business KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 32 }}>

        {/* 0. Portfolio Health Score */}
        <div className="stat-card" style={{ borderLeft: `3px solid ${portfolioColor}` }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Health Score
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: portfolioColor, marginBottom: 4, lineHeight: 1 }}>
            {portfolioHealth != null ? `${portfolioHealth}` : '—'}
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginLeft: 4 }}>/ 100</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {groupsCritical > 0
              ? <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{groupsCritical} crítico{groupsCritical > 1 ? 's' : ''}</span>
              : groupsWarning > 0
                ? <span style={{ color: 'var(--warning)', fontWeight: 600 }}>{groupsWarning} en atención</span>
                : 'Portfolio saludable'}
          </div>
        </div>

        {/* 1. Grupos monitoreados */}
        <div className="stat-card">
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Grupos monitoreados
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--brand-green)', marginBottom: 4 }}>
            {kpis.total_groups}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Grupos activos totales</div>
        </div>

        {/* 2. Mensajes monitoreados */}
        <div className="stat-card">
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Mensajes monitoreados
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--brand-green)', marginBottom: 4 }}>
            {kpis.messages_in_range.toLocaleString()}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{kpis.range_label}</div>
        </div>

        {/* 3. Incidencias creadas */}
        <Link href={`/tickets?range=${range}${kpiFrom ? `&from=${kpiFrom}` : ''}${kpiTo ? `&to=${kpiTo}` : ''}`}
          style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="stat-card" style={{ cursor: 'pointer' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Incidencias abiertas
            </div>
            <div style={{
              fontSize: 28, fontWeight: 800, marginBottom: 4,
              color: kpis.incidents_in_range > 5 ? 'var(--danger)' : kpis.incidents_in_range > 2 ? 'var(--warning)' : 'var(--success)',
            }}>
              {kpis.incidents_in_range}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Tickets creados · {kpis.range_label}</div>
            <div style={{ fontSize: 11, color: 'var(--brand-green)', marginTop: 6, fontWeight: 600 }}>Ver tickets →</div>
          </div>
        </Link>

        {/* 4. Sentiment de clientes */}
        <div className="stat-card">
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Sentiment de clientes
          </div>
          {kpis.avg_sentiment_010 == null ? (
            <span style={{ color: 'var(--text-muted)', fontSize: 28, fontWeight: 700 }}>—</span>
          ) : (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{
                fontSize: 28, fontWeight: 800,
                color: kpis.avg_sentiment_010 >= 7 ? '#10b981' : kpis.avg_sentiment_010 >= 5 ? '#f59e0b' : '#ef4444',
              }}>
                {kpis.avg_sentiment_010.toFixed(1)}
              </span>
              <span style={{ fontSize: 18 }}>
                {kpis.avg_sentiment_010 >= 7 ? '😊' : kpis.avg_sentiment_010 >= 5 ? '😐' : '😟'}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>/10</span>
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Promedio · {kpis.range_label}</div>
          {kpis.avg_sentiment_010 != null && (
            <div style={{ marginTop: 8, height: 4, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{
                width: `${(kpis.avg_sentiment_010 / 10) * 100}%`,
                height: '100%', borderRadius: 99,
                background: sentimentColor,
              }} />
            </div>
          )}
        </div>

        {/* 5. TTFR promedio */}
        <div className="stat-card" title="TTFR — Tiempo desde que el cliente abre el ticket hasta la primera respuesta sustantiva del agente 99.">
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            TTFR promedio
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: ttfrExecColor, marginBottom: 4 }}>
            {fmtMinExec(kpis.avg_ttfr_minutes)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            1ª respuesta del agente 99 · SLA 30m · {kpis.range_label}
          </div>
          {kpis.avg_ttfr_minutes != null && (
            <div style={{ fontSize: 11, marginTop: 6, fontWeight: 600, color: ttfrExecColor }}>
              {kpis.avg_ttfr_minutes <= 10 ? 'Excelente' : kpis.avg_ttfr_minutes <= 30 ? 'Aceptable' : 'Necesita mejora'}
            </div>
          )}
        </div>

        {/* 6. TTR promedio */}
        <div className="stat-card" title="TTR — Tiempo total desde que se abre el ticket hasta que se resuelve. Incluye TTFR + tiempo trabajando el caso.">
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            TTR promedio
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: ttrExecColor, marginBottom: 4 }}>
            {fmtMinExec(kpis.avg_ttr_minutes)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Resolución completa · {kpis.range_label}
          </div>
          {kpis.avg_ttr_minutes != null && (
            <div style={{ fontSize: 11, marginTop: 6, fontWeight: 600, color: ttrExecColor }}>
              {kpis.avg_ttr_minutes <= 60  ? 'Excelente' :
               kpis.avg_ttr_minutes <= 90  ? 'Aceptable' :
               kpis.avg_ttr_minutes <= 240 ? 'Atención'  : 'Crítico'}
            </div>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          OPERATIONAL DETAIL — charts, scorecard, agent breakdowns, etc.
          Driven by its own period filter (7d / 30d / 90d / todos).
      ════════════════════════════════════════════════════════════════════ */}

      {/* ── Compact header: title + filters on same row ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>Tendencias y detalle operativo</h1>
          <p style={{ color: '#6b7280', fontSize: 13, marginTop: 2 }}>
            {periodLabel[period] ?? period}
            {groupId ? ` · ${groups.find(g => g.id === groupId)?.name ?? 'grupo'}` : ' · todos los grupos'}
          </p>
        </div>
        <Suspense fallback={null}>
          <AnalyticsFilters groups={groups} />
        </Suspense>
      </div>

      {/* ── CHARTS FIRST — above the fold ── */}
      <AnalyticsCharts data={timeSeries} periodLabel={periodLabel[period] ?? period} />

      {/* ── KPI Summary cards — below charts ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 28 }}>
        {[
          {
            label: 'Incidencias abiertas',
            value: totalOpen,
            sub: `${altaCount} urgencia alta`,
            color: totalOpen > 5 ? '#ef4444' : '#10b981',
            bg: totalOpen > 5 ? '#fef2f2' : '#f0fdf4',
            href: '/tickets?status=abierto',
            tooltip: 'Tickets actualmente abiertos en todos los grupos.',
          },
          {
            label: 'TTFR global',
            value: fmtMin(avgTtfr),
            sub: 'tiempo a 1ª respuesta',
            color: avgTtfr !== null && avgTtfr > 30 ? '#ef4444' : avgTtfr !== null && avgTtfr > 15 ? '#f59e0b' : '#10b981',
            bg: '#fff',
            href: null,
            tooltip: 'Promedio de tiempo desde que se abre un ticket hasta la primera respuesta sustantiva del agente 99. SLA: 30 min.',
          },
          {
            label: 'TTR global',
            value: fmtMin(avgTtr),
            sub: 'tiempo total a resolución',
            color: avgTtr !== null && avgTtr > 240 ? '#ef4444' : avgTtr !== null && avgTtr > 90 ? '#f59e0b' : '#10b981',
            bg: '#fff',
            href: null,
            tooltip: 'Promedio del tiempo total desde apertura hasta resolución del ticket. Incluye todo el ciclo de vida.',
          },
          {
            label: 'SLA ≤15 min',
            value: slaPct !== null ? `${slaPct}%` : '—',
            sub: 'días con TTFR dentro de meta',
            color: slaPct !== null && slaPct < 60 ? '#ef4444' : slaPct !== null && slaPct < 80 ? '#f59e0b' : '#10b981',
            bg: '#fff',
            href: null,
            tooltip: 'Porcentaje de días donde el TTFR promedio fue ≤15 min.',
          },
          {
            label: '% resuelto mismo día',
            value: sameDay.pct != null ? `${sameDay.pct}%` : '—',
            sub: sameDay.unresolved_eod > 0
              ? `${sameDay.unresolved_eod} no resueltas al EOD`
              : `${sameDay.resolved_same_day}/${sameDay.total} incidencias`,
            color: sameDay.pct != null && sameDay.pct >= 80
              ? '#10b981'
              : sameDay.pct != null && sameDay.pct >= 60 ? '#f59e0b' : '#ef4444',
            bg: sameDay.unresolved_eod > 0 ? '#fef2f2' : '#fff',
            href: '/tickets?status=no_resuelto_eod',
            tooltip: 'De las incidencias abiertas en el rango, qué % se cerraron como "resuelto" en el MISMO día calendario (en la TZ del grupo). Si una incidencia no se resuelve antes del cierre operativo del día, se marca como "no_resuelto_eod" y baja este KPI.',
          },
          {
            label: 'Tipos de problema',
            value: totalProblems,
            sub: `${totalAll > 0 ? Math.round(totalProblems / totalAll * 100) : 0}% del total`,
            color: '#ef4444',
            bg: '#fef2f2',
            href: null,
            tooltip: 'Cantidad de incidencias clasificadas como problema (no operativos / no ruido).',
          },
        ].map(c => {
          const cardStyle: React.CSSProperties = {
            background: c.bg, border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 18px',
            cursor: c.href ? 'pointer' : 'default',
            display: 'block', textDecoration: 'none', color: 'inherit',
          }
          const inner = (
            <>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 500 }}>{c.label}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: c.color, lineHeight: 1 }}>{c.value}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{c.sub}</div>
            </>
          )
          return c.href
            ? <Link key={c.label} href={c.href} style={cardStyle} title={c.tooltip}>{inner}</Link>
            : <div key={c.label} style={cardStyle} title={c.tooltip}>{inner}</div>
        })}
      </div>

      {/* ── Portfolio Message Mix ── */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 22px', marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>
              Mix de mensajes · portfolio
            </div>
            <h3 style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
              {portfolioMix.total.toLocaleString('es-MX')} mensajes clasificados en {Math.min(days, 30)} días
            </h3>
          </div>
          <div style={{ fontSize: 11, color: '#64748b', maxWidth: 480, lineHeight: 1.45 }}>
            <strong style={{ color: '#0f172a' }}>Operativos</strong> = confirmaciones, presentaciones, reportes ·{' '}
            <strong style={{ color: '#0f172a' }}>Incidencias</strong> = problemas reportados ·{' '}
            <strong style={{ color: '#0f172a' }}>Ruido</strong> = saludos / acuses / consultas sin información accionable.
          </div>
        </div>

        {/* Stacked bar */}
        <div style={{ display: 'flex', height: 28, borderRadius: 8, overflow: 'hidden', background: '#f1f5f9' }}>
          {(['operativos', 'incidencias', 'ruido'] as const).map((k) => {
            const pct = portfolioMix[`pct_${k}` as const]
            if (pct === 0) return null
            return (
              <div
                key={k}
                style={{
                  width: `${pct}%`,
                  background: MIX_META[k].color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#fff',
                  textShadow: '0 1px 2px rgba(0,0,0,0.18)',
                }}
                title={`${MIX_META[k].label}: ${portfolioMix[k as 'operativos'|'incidencias'|'ruido']} (${pct}%)`}
              >
                {pct >= 6 ? `${pct}%` : ''}
              </div>
            )
          })}
        </div>

        {/* Bucket pills */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 14 }}>
          {(['operativos', 'incidencias', 'ruido'] as const).map((k) => {
            const meta = MIX_META[k]
            const pct = portfolioMix[`pct_${k}` as const]
            const cnt = portfolioMix[k as 'operativos'|'incidencias'|'ruido']
            return (
              <div
                key={k}
                style={{
                  background: meta.bg,
                  border: `1px solid ${meta.border}`,
                  borderRadius: 8,
                  padding: '10px 12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {meta.label}
                  </span>
                  <span style={{ fontSize: 22, fontWeight: 800, color: meta.color, lineHeight: 1 }}>{pct}%</span>
                </div>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 4, lineHeight: 1.4 }}>
                  {cnt.toLocaleString('es-MX')} msgs · {meta.desc}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Churn Risk Detection ── */}
      <ChurnAnalyticsCard counts={churnCounts} trend={churnTrend} />

      {/* ── Multi-week trend (T08) ── */}
      <MultiWeekTrendCard
        rows={weeklyTrend}
        weeksParam={weeks}
        title={groupId ? `Tendencia ${weeks} semanas — ${groups.find(g => g.id === groupId)?.name ?? 'grupo'}` : `Tendencia ${weeks} semanas — portfolio`}
      />

      {/* ── TTFR by category ── */}
      <TtfrByCategoryCard rows={ttfrByCategory} periodLabel={periodLabel[period] ?? period} />

      {/* ── Classification feedback (T07) ── */}
      <div style={{
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14,
        padding: '18px 24px', marginBottom: 32,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#0f172a' }}>
              Correcciones de clasificación
            </h2>
            <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
              Feedback humano sobre lo que Sonnet/Haiku clasificó —
              {feedbackCounts.last_submitted_at
                ? ` última hace ${(() => {
                    const ms = Date.now() - new Date(feedbackCounts.last_submitted_at).getTime()
                    const h = Math.floor(ms / 3_600_000)
                    if (h < 1)  return `${Math.floor(ms / 60_000)} min`
                    if (h < 24) return `${h}h`
                    return `${Math.floor(h / 24)}d`
                  })()}`
                : ' aún no hay correcciones registradas.'}
            </p>
          </div>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>
            {periodLabel[period] ?? period}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          {/* Total */}
          <div style={feedbackKpi('#0f172a', '#f1f5f9', '#e2e8f0')}>
            <span style={feedbackLabel}>Total</span>
            <span style={feedbackValue}>{feedbackCounts.total}</span>
            <span style={feedbackHint}>
              {feedbackCounts.unique_incidents} ticket{feedbackCounts.unique_incidents === 1 ? '' : 's'}
            </span>
          </div>
          {/* By field */}
          {(['category', 'urgency', 'sentiment', 'summary', 'bucket', 'other'] as const).map((f) => {
            const v = feedbackCounts.by_field[f]
            if (v === 0 && feedbackCounts.total > 0 && f !== 'category' && f !== 'urgency' && f !== 'sentiment') return null
            const COLOR: Record<typeof f, [string, string, string]> = {
              category:  ['#0369a1', '#eff6ff', '#bfdbfe'],
              urgency:   ['#b91c1c', '#fef2f2', '#fecaca'],
              sentiment: ['#9333ea', '#faf5ff', '#e9d5ff'],
              summary:   ['#0d9488', '#f0fdfa', '#99f6e4'],
              bucket:    ['#a16207', '#fffbeb', '#fde68a'],
              other:     ['#475569', '#f8fafc', '#cbd5e1'],
            }
            const [color, bg, border] = COLOR[f]
            return (
              <div key={f} style={feedbackKpi(color, bg, border)}>
                <span style={feedbackLabel}>{FEEDBACK_FIELD_LABEL[f]}</span>
                <span style={feedbackValue}>{v}</span>
                <span style={feedbackHint}>
                  {feedbackCounts.total > 0 ? Math.round((v / feedbackCounts.total) * 100) : 0}%
                </span>
              </div>
            )
          })}
        </div>

        <p style={{ fontSize: 11, color: '#94a3b8', margin: '14px 0 0', lineHeight: 1.5 }}>
          Cada corrección sobrescribe el campo en el ticket y queda registrada en{' '}
          <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4, fontSize: 10 }}>
            classification_feedback
          </code>
          {' '}para reentrenar prompts y medir la calidad del modelo.
        </p>
      </div>

      {/* ── Group Scorecard ── */}
      {scorecard.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', marginBottom: 32 }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid #f1f5f9' }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#0f172a' }}>Estado por grupo</h2>
            <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
              Ordenado por riesgo — sentiment, TTFR (1ª respuesta), TTR (resolución) y tasa de cierre por cliente
            </p>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {[
                    { h: 'Grupo' },
                    { h: 'Cliente' },
                    { h: 'País' },
                    { h: 'Mensajes' },
                    { h: 'Inc. abiertas' },
                    { h: 'Sentiment' },
                    { h: 'TTFR avg', tip: 'Tiempo a primera respuesta del agente 99 (promedio en el período).' },
                    { h: 'TTR avg',  tip: 'Tiempo total a resolución (promedio en el período, sólo cerrados).' },
                    { h: 'Resolución' },
                    { h: 'Estado' },
                  ].map(({ h, tip }) => (
                    <th key={h} title={tip} style={{
                      padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#64748b',
                      textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em',
                      whiteSpace: 'nowrap', borderBottom: '1px solid #f1f5f9',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scorecard.map((g, i) => (
                  <tr key={g.id} style={{
                    borderBottom: '1px solid #f8fafc',
                    background: g.risk === 'high' ? '#fffafa' : i % 2 === 0 ? '#fff' : '#fafafa',
                  }}>
                    <td style={{ padding: '11px 14px' }}>
                      <Link href={`/grupos/${g.id}`} style={{ color: '#16a34a', fontWeight: 600, fontSize: 13, textDecoration: 'none' }}>
                        {g.name}
                      </Link>
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: '#374151' }}>
                      {g.client_name ?? <span style={{ color: '#94a3b8' }}>—</span>}
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 12, color: '#64748b' }}>
                      {g.country ?? '—'}
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: '#374151', textAlign: 'center' }}>
                      {g.total_messages}
                    </td>
                    <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                      {g.open_incidents > 0 ? (
                        <Link href={`/tickets?group=${g.id}&status=abierto`} style={{
                          color: g.open_incidents > 3 ? '#ef4444' : '#f59e0b',
                          fontWeight: 700, fontSize: 14, textDecoration: 'none',
                        }}>
                          {g.open_incidents}
                        </Link>
                      ) : (
                        <span style={{ color: '#10b981', fontWeight: 600 }}>0</span>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                      <SentimentDot val={g.avg_sentiment} />
                    </td>
                    <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                      <TtfrBadge min={g.avg_ttfr_minutes} />
                    </td>
                    <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                      <TtrBadge min={g.avg_ttr_minutes} />
                    </td>
                    <td style={{ padding: '11px 14px', textAlign: 'center', fontSize: 13, color: '#374151' }}>
                      {g.resolution_rate !== null ? (
                        <span style={{ color: g.resolution_rate >= 70 ? '#10b981' : g.resolution_rate >= 40 ? '#f59e0b' : '#ef4444', fontWeight: 700 }}>
                          {g.resolution_rate}%
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <RiskBadge risk={g.risk} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tipos de problema ── */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', marginBottom: 32 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #f1f5f9' }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#0f172a' }}>Tipificación de incidencias</h2>
          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
            {totalProblems} incidencias · {totalAll} mensajes totales · {periodLabel[period] ?? period}
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
          <div style={{ borderRight: '1px solid #f1f5f9' }}>
            <div style={{ padding: '10px 24px', background: '#fef2f2', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                🚨 Problemas — {totalProblems}
              </span>
            </div>
            {problems.length === 0 ? (
              <div style={{ padding: 24, color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>Sin problemas en este período</div>
            ) : problems.map((item, i) => {
              const barColor = BUCKET_COLORS[item.category] ?? '#ef4444'
              return (
                <div key={item.category} style={{
                  padding: '14px 24px',
                  borderBottom: i < problems.length - 1 ? '1px solid #f8fafc' : 'none',
                  background: i % 2 === 0 ? '#fff' : '#fafafa',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{item.label}</span>
                      <div style={{ display: 'flex', gap: 8, marginTop: 3 }}>
                        {item.urgency_alta > 0 && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', background: '#fef2f2', padding: '1px 6px', borderRadius: 99 }}>
                            {item.urgency_alta} alta
                          </span>
                        )}
                        {item.urgency_media > 0 && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#f59e0b', background: '#fffbeb', padding: '1px 6px', borderRadius: 99 }}>
                            {item.urgency_media} media
                          </span>
                        )}
                        {item.avg_ttfr_min != null && (
                          <span style={{ fontSize: 10, color: '#64748b' }}>TTFR {item.avg_ttfr_min}m</span>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                      <span style={{ fontSize: 20, fontWeight: 800, color: barColor }}>{item.count}</span>
                      <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 4 }}>({item.pct}%)</span>
                    </div>
                  </div>
                  <div style={{ height: 6, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ width: `${(item.count / (problems[0].count || 1)) * 100}%`, height: '100%', borderRadius: 99, background: barColor }} />
                  </div>
                </div>
              )
            })}
          </div>

          <div>
            <div style={{ padding: '10px 24px', background: '#f0fdf4', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                ✅ Operativas — {totalAll - totalProblems}
              </span>
            </div>
            {operations.length === 0 ? (
              <div style={{ padding: 24, color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>Sin datos</div>
            ) : operations.map((item, i) => {
              const barColor = BUCKET_COLORS[item.category] ?? '#10b981'
              return (
                <div key={item.category} style={{
                  padding: '14px 24px',
                  borderBottom: i < operations.length - 1 ? '1px solid #f8fafc' : 'none',
                  background: i % 2 === 0 ? '#fff' : '#fafafa',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{item.label}</span>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                      <span style={{ fontSize: 20, fontWeight: 800, color: barColor }}>{item.count}</span>
                      <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 4 }}>({item.pct}%)</span>
                    </div>
                  </div>
                  <div style={{ height: 6, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ width: `${(item.count / (operations[0].count || 1)) * 100}%`, height: '100%', borderRadius: 99, background: barColor }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Agent Analysis (full width) ── */}
      <AgentLeaderboardCard rows={agentAnalysis} periodLabel={periodLabel[period] ?? period} />

      {/* ── Open Incidents (side panel) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 24, marginBottom: 32 }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#111827' }}>Incidencias abiertas</h2>
            <Link href="/tickets?status=abierto" style={{ fontSize: 13, color: '#16a34a', textDecoration: 'none', fontWeight: 500 }}>Ver tickets →</Link>
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {openIncidents.length === 0 ? (
              <div style={{ padding: '24px', color: '#6b7280', fontSize: 14, textAlign: 'center' }}>Sin incidencias abiertas</div>
            ) : openIncidents.map(inc => (
              <div key={inc.id} style={{ padding: '11px 20px', borderBottom: '1px solid #f3f4f6', background: inc.urgency === 'alta' ? '#fffafa' : '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {inc.urgency === 'alta' && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', background: '#fef2f2', padding: '1px 6px', borderRadius: 99 }}>ALTA</span>
                    )}
                    <Link href={`/grupos/${inc.group_id}`} style={{ color: '#16a34a', fontWeight: 600, fontSize: 13, textDecoration: 'none' }}>
                      {inc.group_name}
                    </Link>
                  </div>
                  <span style={{ fontSize: 12, color: inc.open_hours > 4 ? '#ef4444' : '#94a3b8', fontWeight: 600 }}>
                    {inc.open_hours.toFixed(1)}h
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {CATEGORY_ES[inc.category ?? ''] ?? inc.category?.replace(/_/g, ' ')}
                  {inc.ttfr_seconds !== null && ` · TTFR ${formatMinutes(inc.ttfr_seconds)}`}
                </div>
                {inc.summary && (
                  <div style={{ marginTop: 4, fontSize: 12, color: '#374151', fontStyle: 'italic', lineHeight: 1.4 }}>{inc.summary}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Daily reports ── */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f3f4f6' }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#111827' }}>Reportes diarios (14 días)</h2>
        </div>
        {dailyReports.length === 0 ? (
          <div style={{ padding: '32px 20px', color: '#6b7280', fontSize: 14, textAlign: 'center' }}>
            Sin reportes diarios aún. Se generan a las 10pm CDMX.
          </div>
        ) : dailyReports.map(r => {
          const ratioBPct = r.ratio_b !== null ? (r.ratio_b * 100) : null
          return (
            <div key={r.id} style={{ borderBottom: '1px solid #f3f4f6', padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24 }}>
                <div style={{ minWidth: 220 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 6 }}>
                    {new Date(r.report_date).toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' })}
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>{r.total_messages} msgs</span>
                    <span style={{ fontSize: 12, color: '#10b981' }}>Operativos: {r.bucket_a_count}</span>
                    <span style={{ fontSize: 12, color: '#ef4444' }}>Incidencias: {r.bucket_b_count}</span>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>Ruido: {r.bucket_c_count}</span>
                    {ratioBPct !== null && (
                      <span style={{ fontSize: 12, color: ratioBPct > 25 ? '#ef4444' : '#6b7280' }}>
                        ratio {ratioBPct.toFixed(0)}%
                      </span>
                    )}
                    {r.avg_ttfr_seconds !== null && (
                      <span style={{ fontSize: 12, color: r.avg_ttfr_seconds > 1800 ? '#ef4444' : '#10b981' }}>
                        TTFR {formatMinutes(r.avg_ttfr_seconds)}
                      </span>
                    )}
                  </div>
                </div>
                {r.sonnet_narrative && (
                  <div style={{
                    flex: 1, fontSize: 13, color: '#374151', lineHeight: 1.6,
                    whiteSpace: 'pre-wrap', background: '#f9fafb', borderRadius: 8,
                    padding: '10px 14px', maxHeight: 180, overflowY: 'auto',
                  }}>
                    {r.sonnet_narrative}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
