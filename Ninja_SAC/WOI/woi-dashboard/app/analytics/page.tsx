import { getAgentLeaderboard, getOpenIncidents, getDailyReports } from '@/lib/queries'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const URGENCY_COLOR: Record<string, string> = {
  alta: '#ef4444',
  media: '#f59e0b',
  baja: '#6b7280',
}

const URGENCY_BG: Record<string, string> = {
  alta: '#fef2f2',
  media: '#fffbeb',
  baja: '#f9fafb',
}

function UrgencyBadge({ urgency }: { urgency: string | null }) {
  if (!urgency) return null
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600,
      color: URGENCY_COLOR[urgency] ?? '#6b7280',
      background: URGENCY_BG[urgency] ?? '#f9fafb',
    }}>
      {urgency.toUpperCase()}
    </span>
  )
}

function formatMinutes(seconds: number | null) {
  if (seconds === null) return '—'
  const m = Math.round(seconds / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

function OpenHours({ hours }: { hours: number }) {
  const color = hours > 4 ? '#ef4444' : hours > 1 ? '#f59e0b' : '#10b981'
  return <span style={{ color, fontWeight: 600 }}>{hours.toFixed(1)}h</span>
}

function RatioBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 80, height: 6, background: '#e5e7eb', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: 99 }} />
      </div>
      <span style={{ fontSize: 12, color: '#374151' }}>{pct.toFixed(0)}%</span>
    </div>
  )
}

function TtfrColor({ minutes }: { minutes: number | null }) {
  if (minutes === null) return <span style={{ color: '#9ca3af' }}>—</span>
  const color = minutes > 30 ? '#ef4444' : minutes > 15 ? '#f59e0b' : '#10b981'
  const bg = minutes > 30 ? '#fef2f2' : minutes > 15 ? '#fffbeb' : '#f0fdf4'
  return (
    <span style={{ color, background: bg, padding: '2px 8px', borderRadius: 6, fontSize: 13, fontWeight: 600 }}>
      {minutes.toFixed(0)}m
    </span>
  )
}

export default async function AnalyticsPage() {
  const [agents, openIncidents, dailyReports] = await Promise.all([
    getAgentLeaderboard(),
    getOpenIncidents(),
    getDailyReports(14),
  ])

  const totalOpen = openIncidents.length
  const altaCount = openIncidents.filter(i => i.urgency === 'alta').length
  const avgTtfr = agents.length > 0
    ? agents.filter(a => a.avg_ttfr_minutes !== null).reduce((s, a) => s + (a.avg_ttfr_minutes ?? 0), 0) / agents.filter(a => a.avg_ttfr_minutes !== null).length
    : null

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1400, margin: '0 auto', paddingBottom: 80 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 }}>Analytics</h1>
          <p style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>
            Leaderboard de agentes · Incidencias abiertas · Reportes diarios
          </p>
        </div>
        <Link href="/" style={{ color: '#5a9e2f', fontSize: 14, textDecoration: 'none' }}>
          ← Grupos
        </Link>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 40 }}>
        {[
          { label: 'Incidencias abiertas', value: totalOpen, color: totalOpen > 5 ? '#ef4444' : '#10b981', bg: totalOpen > 5 ? '#fef2f2' : '#f0fdf4' },
          { label: 'Urgencia ALTA', value: altaCount, color: altaCount > 0 ? '#ef4444' : '#10b981', bg: altaCount > 0 ? '#fef2f2' : '#f0fdf4' },
          { label: 'TTFR global (7d)', value: avgTtfr !== null ? `${avgTtfr.toFixed(0)}m` : '—', color: avgTtfr !== null && avgTtfr > 30 ? '#ef4444' : '#10b981', bg: '#f9fafb' },
        ].map(c => (
          <div key={c.label} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 24px' }}>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>{c.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginBottom: 40 }}>
        {/* Open Incidents */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#111827' }}>
              Incidencias abiertas
            </h2>
            <span style={{ fontSize: 13, color: '#6b7280' }}>{totalOpen} total</span>
          </div>
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            {openIncidents.length === 0 ? (
              <div style={{ padding: '24px 20px', color: '#6b7280', fontSize: 14, textAlign: 'center' }}>
                Sin incidencias abiertas
              </div>
            ) : (
              openIncidents.map(inc => (
                <div key={inc.id} style={{
                  padding: '12px 20px', borderBottom: '1px solid #f3f4f6',
                  background: inc.urgency === 'alta' ? '#fffafa' : '#fff',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <UrgencyBadge urgency={inc.urgency} />
                      <Link href={`/grupos/${inc.group_id}`} style={{ color: '#5a9e2f', fontWeight: 600, fontSize: 13, textDecoration: 'none' }}>
                        {inc.group_name}
                      </Link>
                    </div>
                    <OpenHours hours={inc.open_hours} />
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {inc.category?.replace(/_/g, ' ')} · {inc.message_count} msgs
                    {inc.ttfr_seconds !== null && ` · TTFR ${formatMinutes(inc.ttfr_seconds)}`}
                  </div>
                  {inc.summary && (
                    <div style={{ marginTop: 6, fontSize: 12, color: '#374151', fontStyle: 'italic', lineHeight: 1.4 }}>
                      {inc.summary}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Agent Leaderboard */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#111827' }}>
              Leaderboard agentes (7 días)
            </h2>
            <span style={{ fontSize: 13, color: '#6b7280' }}>{agents.length} activos</span>
          </div>
          {agents.length === 0 ? (
            <div style={{ padding: '24px 20px', color: '#6b7280', fontSize: 14, textAlign: 'center' }}>
              Sin datos de agentes
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  {['Agente', 'Incidencias', 'TTFR avg', 'TTR avg', 'Resol. %'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6b7280', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agents.map((a, i) => (
                  <tr key={a.agent_phone} style={{ borderTop: '1px solid #f3f4f6', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>
                        {a.agent_name || `...${a.agent_phone.slice(-4)}`}
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13, color: '#374151', textAlign: 'center' }}>
                      {a.incidents_attended}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      <TtfrColor minutes={a.avg_ttfr_minutes} />
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13, color: '#6b7280', textAlign: 'center' }}>
                      {a.avg_ttr_minutes !== null ? `${a.avg_ttr_minutes?.toFixed(0)}m` : '—'}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {a.resolution_rate_pct !== null ? (
                        <RatioBar pct={a.resolution_rate_pct} color={a.resolution_rate_pct >= 70 ? '#10b981' : a.resolution_rate_pct >= 40 ? '#f59e0b' : '#ef4444'} />
                      ) : <span style={{ color: '#9ca3af' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Daily reports */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f3f4f6' }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#111827' }}>Reportes diarios (14 días)</h2>
        </div>
        {dailyReports.length === 0 ? (
          <div style={{ padding: '32px 20px', color: '#6b7280', fontSize: 14, textAlign: 'center' }}>
            Sin reportes diarios aún. Se generan al correr <code>woi-analyze daily</code>.
          </div>
        ) : (
          dailyReports.map(r => {
            const ratioBPct = r.ratio_b !== null ? (r.ratio_b * 100) : null
            return (
              <div key={r.id} style={{ borderBottom: '1px solid #f3f4f6', padding: '16px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24 }}>
                  <div style={{ minWidth: 240 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 6 }}>
                      {new Date(r.report_date).toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' })}
                    </div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, color: '#6b7280' }}>{r.total_messages} msgs</span>
                      <span style={{ fontSize: 12, color: '#10b981' }}>A={r.bucket_a_count}</span>
                      <span style={{ fontSize: 12, color: '#ef4444' }}>B={r.bucket_b_count}</span>
                      <span style={{ fontSize: 12, color: '#6b7280' }}>C={r.bucket_c_count}</span>
                      {ratioBPct !== null && (
                        <span style={{ fontSize: 12, color: ratioBPct > 25 ? '#ef4444' : '#6b7280' }}>
                          ratio B={ratioBPct.toFixed(0)}%
                        </span>
                      )}
                      <span style={{ fontSize: 12, color: '#6b7280' }}>
                        {r.incidents_opened} abiertos · {r.incidents_closed} cerrados
                      </span>
                      {r.avg_ttfr_seconds !== null && (
                        <span style={{ fontSize: 12, color: r.avg_ttfr_seconds > 1800 ? '#ef4444' : '#10b981' }}>
                          TTFR avg {formatMinutes(r.avg_ttfr_seconds)}
                        </span>
                      )}
                      {r.haiku_consistency_pct !== null && (
                        <span style={{ fontSize: 12, color: '#6b7280' }}>
                          consistencia Haiku {r.haiku_consistency_pct.toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </div>
                  {r.sonnet_narrative && (
                    <div style={{ flex: 1, fontSize: 13, color: '#374151', lineHeight: 1.6, fontFamily: 'monospace', whiteSpace: 'pre-wrap', background: '#f9fafb', borderRadius: 8, padding: '10px 14px', maxHeight: 200, overflowY: 'auto' }}>
                      {r.sonnet_narrative}
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
