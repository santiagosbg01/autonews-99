import {
  getAgentLeaderboard,
  getOpenIncidents,
  getDailyReports,
  getIncidentCategoryBreakdown,
  getAnalyticsTimeSeries,
  getGroupScorecard,
  CATEGORY_ES,
} from '@/lib/queries'
import Link from 'next/link'
import { Suspense } from 'react'
import AnalyticsFilters from '@/app/components/AnalyticsFilters'
import nextDynamic from 'next/dynamic'

const TrendChart = nextDynamic(() => import('@/app/components/TrendChart'), { ssr: false })
const TtfrChart  = nextDynamic(() => import('@/app/components/TtfrChart'),  { ssr: false })

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
  return (
    <span style={{ color, background: bg, padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
      {min}m
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

  const { from, to } = resolveDates(period)

  const [agents, openIncidents, dailyReports, categoryBreakdown, timeSeries, scorecard] = await Promise.all([
    getAgentLeaderboard(),
    getOpenIncidents(),
    getDailyReports(14),
    getIncidentCategoryBreakdown(days),
    getAnalyticsTimeSeries(from, to, groupId),
    getGroupScorecard(from, to),
  ])

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
  const slaOk = timeSeries.filter(d => d.ttfr_minutes != null && d.ttfr_minutes <= 15).length
  const slaPct = timeSeries.filter(d => d.ttfr_minutes != null).length > 0
    ? Math.round(slaOk / timeSeries.filter(d => d.ttfr_minutes != null).length * 100)
    : null

  const periodLabel: Record<string, string> = {
    '7d': 'últimos 7 días', '30d': 'últimos 30 días', '90d': 'últimos 90 días', todos: 'todo el tiempo',
  }

  return (
    <div style={{ paddingBottom: 80 }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 }}>Analytics</h1>
          <p style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>
            {periodLabel[period] ?? period}
            {groupId ? ` · ${groups.find(g => g.id === groupId)?.name ?? 'grupo'}` : ' · todos los grupos'}
          </p>
        </div>
        <Suspense fallback={null}>
          <AnalyticsFilters groups={groups} />
        </Suspense>
      </div>

      {/* ── KPI Summary cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 32 }}>
        {[
          {
            label: 'Incidencias abiertas',
            value: totalOpen,
            sub: `${altaCount} urgencia alta`,
            color: totalOpen > 5 ? '#ef4444' : '#10b981',
            bg: totalOpen > 5 ? '#fef2f2' : '#f0fdf4',
            href: '/tickets?status=abierto',
          },
          {
            label: 'TTFR global',
            value: avgTtfr !== null ? `${avgTtfr.toFixed(0)}m` : '—',
            sub: 'tiempo hasta primera respuesta',
            color: avgTtfr !== null && avgTtfr > 30 ? '#ef4444' : avgTtfr !== null && avgTtfr > 15 ? '#f59e0b' : '#10b981',
            bg: '#fff',
            href: null,
          },
          {
            label: 'SLA ≤15 min',
            value: slaPct !== null ? `${slaPct}%` : '—',
            sub: 'días con TTFR dentro de meta',
            color: slaPct !== null && slaPct < 60 ? '#ef4444' : slaPct !== null && slaPct < 80 ? '#f59e0b' : '#10b981',
            bg: '#fff',
            href: null,
          },
          {
            label: 'Tipos de problema',
            value: totalProblems,
            sub: `${totalAll > 0 ? Math.round(totalProblems / totalAll * 100) : 0}% del total`,
            color: '#ef4444',
            bg: '#fef2f2',
            href: null,
          },
        ].map(c => (
          <div key={c.label} style={{
            background: c.bg, border: '1px solid #e5e7eb', borderRadius: 12, padding: '16px 20px',
            cursor: c.href ? 'pointer' : 'default',
          }}
            onClick={c.href ? () => window.location.href = c.href! : undefined}
          >
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6, fontWeight: 500 }}>{c.label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: c.color, lineHeight: 1 }}>{c.value}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Charts section ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 24, marginBottom: 32 }}>
        {/* Main trend chart */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '20px 24px' }}>
          <div style={{ marginBottom: 4 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#0f172a' }}>Mensajes · Incidencias · Sentiment</h2>
            <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 16px' }}>
              Tendencia diaria — {periodLabel[period] ?? period}
            </p>
          </div>
          <TrendChart data={timeSeries} />
        </div>

        {/* TTFR + Resolution chart */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '20px 24px' }}>
          <div style={{ marginBottom: 4 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#0f172a' }}>TTFR y Tasa de resolución</h2>
            <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 16px' }}>
              Tiempo hasta primera respuesta (barras) y % de incidencias resueltas (línea)
            </p>
          </div>
          <TtfrChart data={timeSeries} />
        </div>
      </div>

      {/* ── Group Scorecard ── */}
      {scorecard.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', marginBottom: 32 }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid #f1f5f9' }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#0f172a' }}>Estado por grupo</h2>
            <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
              Ordenado por riesgo — sentiment, TTFR y tasa de resolución por cliente
            </p>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {['Grupo', 'Cliente', 'País', 'Mensajes', 'Inc. abiertas', 'Sentiment', 'TTFR avg', 'Resolución', 'Estado'].map(h => (
                    <th key={h} style={{
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

      {/* ── Agent Leaderboard ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32 }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#111827' }}>Leaderboard agentes</h2>
            <span style={{ fontSize: 13, color: '#6b7280' }}>{agents.length} activos</span>
          </div>
          {agents.length === 0 ? (
            <div style={{ padding: '24px', color: '#6b7280', fontSize: 14, textAlign: 'center' }}>Sin datos de agentes</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  {['#', 'Agente', 'Incid.', 'TTFR', 'TTR', 'Resol.'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#6b7280', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agents.map((a, i) => (
                  <tr key={a.agent_phone} style={{ borderTop: '1px solid #f3f4f6', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>#{i + 1}</td>
                    <td style={{ padding: '9px 12px' }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>
                        {a.agent_name || `...${a.agent_phone.slice(-4)}`}
                      </div>
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: '#374151', textAlign: 'center' }}>{a.incidents_attended}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                      <TtfrBadge min={a.avg_ttfr_minutes !== null ? Math.round(a.avg_ttfr_minutes) : null} />
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#6b7280', textAlign: 'center' }}>
                      {a.avg_ttr_minutes !== null ? `${a.avg_ttr_minutes?.toFixed(0)}m` : '—'}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12, textAlign: 'center' }}>
                      {a.resolution_rate_pct !== null ? (
                        <span style={{ color: a.resolution_rate_pct >= 70 ? '#10b981' : a.resolution_rate_pct >= 40 ? '#f59e0b' : '#ef4444', fontWeight: 700 }}>
                          {a.resolution_rate_pct.toFixed(0)}%
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Open Incidents */}
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
