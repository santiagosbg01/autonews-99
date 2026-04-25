import {
  getBriefingsForDate,
  briefingSeverityScore,
  type MorningBriefing,
} from '@/lib/queries'
import Link from 'next/link'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const COUNTRY_FLAG: Record<string, string> = {
  MX: '🇲🇽', PE: '🇵🇪', CL: '🇨🇱', CO: '🇨🇴', AR: '🇦🇷', BR: '🇧🇷',
}
const COUNTRY_NAME: Record<string, string> = {
  MX: 'México', PE: 'Perú', CL: 'Chile', CO: 'Colombia', AR: 'Argentina', BR: 'Brasil',
}

function formatDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function severityBadge(score: number): { label: string; color: string; bg: string; border: string } {
  if (score >= 100) return { label: 'CRÍTICO',  color: '#7f1d1d', bg: '#fef2f2', border: '#fecaca' }
  if (score >= 30)  return { label: 'ATENCIÓN', color: '#b45309', bg: '#fffbeb', border: '#fed7aa' }
  if (score >= 10)  return { label: 'WATCH',    color: '#0369a1', bg: '#eff6ff', border: '#bfdbfe' }
  return { label: 'OK', color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' }
}

export default async function BriefingHubPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const sp = await searchParams
  // If no date param, fetch the latest briefing per group (regardless of date,
  // since groups in different timezones may not share a "today")
  const briefings: MorningBriefing[] = await getBriefingsForDate(sp.date)

  if (!briefings.length) {
    return (
      <div style={{ paddingBottom: 80 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 }}>Morning Briefings</h1>
        <p style={{ color: '#6b7280', fontSize: 14, marginTop: 8, lineHeight: 1.6 }}>
          Aún no hay briefings generados. Cada grupo recibe el suyo automáticamente a las
          <strong> 06:00 hora local</strong> (México, Perú, Chile, Colombia…).
        </p>
      </div>
    )
  }

  // Sort by severity desc, then by group name
  const sorted = [...briefings].sort((a, b) => {
    const sa = briefingSeverityScore(a)
    const sb = briefingSeverityScore(b)
    if (sa !== sb) return sb - sa
    return (a.group_name ?? '').localeCompare(b.group_name ?? '')
  })

  // Group by country
  const byCountry = new Map<string, MorningBriefing[]>()
  for (const b of sorted) {
    const c = b.group_country ?? 'OTRO'
    if (!byCountry.has(c)) byCountry.set(c, [])
    byCountry.get(c)!.push(b)
  }

  // Counters
  const totalChurn  = sorted.reduce((acc, b) => acc + (b.briefing.churn_signals?.length ?? 0), 0)
  const totalCrit   = sorted.reduce(
    (acc, b) => acc + (b.briefing.highlights ?? []).filter(h => h.severity === 'critical').length,
    0,
  )
  const groupsWithChurn = sorted.filter(b => (b.briefing.churn_signals?.length ?? 0) > 0).length

  return (
    <div style={{ paddingBottom: 80 }}>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#16a34a', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Morning Briefings
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0f172a', margin: '4px 0 0', lineHeight: 1.2 }}>
          {sp.date ? formatDate(sp.date) : 'Briefings recientes por grupo'}
        </h1>
        <p style={{ color: '#475569', fontSize: 13, marginTop: 4 }}>
          {sp.date
            ? `${sorted.length} briefings generados el ${sp.date}`
            : `Último briefing por grupo · ${sorted.length} grupos`}
          {' · '}
          Cada grupo se ejecuta a las 06:00 hora local de su país.
        </p>
      </div>

      {/* Summary banner */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 10,
        marginBottom: 22,
      }}>
        {[
          {
            label: 'Grupos con briefing',
            value: sorted.length,
            sub: 'hoy',
            color: '#0f172a',
          },
          {
            label: 'Grupos con churn risk',
            value: groupsWithChurn,
            sub: groupsWithChurn > 0 ? 'atención inmediata' : 'sin alertas',
            color: groupsWithChurn > 0 ? '#dc2626' : '#15803d',
          },
          {
            label: 'Señales de churn',
            value: totalChurn,
            sub: 'frases agresivas / amenazas',
            color: totalChurn > 0 ? '#dc2626' : '#94a3b8',
          },
          {
            label: 'Highlights críticos',
            value: totalCrit,
            sub: 'requieren acción',
            color: totalCrit > 0 ? '#b45309' : '#94a3b8',
          },
        ].map(k => (
          <div key={k.label} style={{
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 18px',
          }}>
            <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 500, marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Briefings by country */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        {Array.from(byCountry.entries()).map(([country, list]) => (
          <div key={country}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
              borderBottom: '1px solid #e5e7eb', paddingBottom: 6,
            }}>
              <span style={{ fontSize: 18 }}>{COUNTRY_FLAG[country] ?? '🌎'}</span>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                {COUNTRY_NAME[country] ?? country} · {list.length} {list.length === 1 ? 'grupo' : 'grupos'}
              </h2>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: 12,
            }}>
              {list.map(b => {
                const score = briefingSeverityScore(b)
                const badge = severityBadge(score)
                const churn = b.briefing.churn_signals?.length ?? 0
                const crit = (b.briefing.highlights ?? []).filter(h => h.severity === 'critical').length
                const warn = (b.briefing.highlights ?? []).filter(h => h.severity === 'warning').length
                const ttfrMin = b.avg_ttfr_seconds ? Math.round(b.avg_ttfr_seconds / 60) : null
                const sentiment010 = b.avg_sentiment != null
                  ? Math.round(((Number(b.avg_sentiment) + 1) / 2) * 100) / 10
                  : null

                return (
                  <Link
                    key={b.id}
                    href={`/briefing/${b.group_id}?date=${b.briefing_date}`}
                    style={{
                      background: '#fff',
                      border: `1px solid ${badge.border}`,
                      borderLeft: `4px solid ${badge.color}`,
                      borderRadius: 12,
                      padding: '14px 16px',
                      textDecoration: 'none',
                      color: 'inherit',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      transition: 'transform 0.1s',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <strong style={{ fontSize: 13, color: '#0f172a', lineHeight: 1.3, flex: 1 }}>
                        {b.group_name}
                      </strong>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: badge.color,
                        background: badge.bg, padding: '2px 8px', borderRadius: 999,
                        whiteSpace: 'nowrap', letterSpacing: '0.05em',
                      }}>
                        {badge.label}
                      </span>
                    </div>

                    {b.headline && (
                      <p style={{ fontSize: 12, color: '#475569', lineHeight: 1.4, margin: 0, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {b.headline}
                      </p>
                    )}

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                      {churn > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#7f1d1d', background: '#fee2e2', padding: '2px 8px', borderRadius: 999 }}>
                          {churn} churn
                        </span>
                      )}
                      {crit > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#b45309', background: '#fef3c7', padding: '2px 8px', borderRadius: 999 }}>
                          {crit} crit
                        </span>
                      )}
                      {warn > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#0369a1', background: '#e0f2fe', padding: '2px 8px', borderRadius: 999 }}>
                          {warn} warn
                        </span>
                      )}
                      {(b.incidents_escalated ?? 0) > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#7f1d1d', background: '#fee2e2', padding: '2px 8px', borderRadius: 999 }}>
                          {b.incidents_escalated} escaladas
                        </span>
                      )}
                    </div>

                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      borderTop: '1px solid #f1f5f9', paddingTop: 8, marginTop: 4,
                      fontSize: 11, color: '#64748b',
                    }}>
                      <span>{b.total_messages ?? 0} msgs</span>
                      <span>{b.total_incidents ?? 0} inc</span>
                      <span style={{ color: ttfrMin && ttfrMin > 30 ? '#dc2626' : ttfrMin && ttfrMin > 15 ? '#d97706' : '#16a34a', fontWeight: 600 }}>
                        TTFR {ttfrMin != null ? `${ttfrMin}m` : '—'}
                      </span>
                      <span style={{ color: sentiment010 != null && sentiment010 < 5 ? '#dc2626' : sentiment010 != null && sentiment010 < 7 ? '#d97706' : '#16a34a', fontWeight: 600 }}>
                        {sentiment010 != null ? `${sentiment010}/10` : '—'}
                      </span>
                    </div>

                    <div style={{ fontSize: 10, color: '#94a3b8' }}>
                      {b.briefing_date} · TZ {b.timezone ?? '—'}
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
