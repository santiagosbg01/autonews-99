import {
  getOpenChurnSignals,
  getChurnOpenCounts,
  getChurnDailyTrend,
  CHURN_SEVERITY_META,
  CHURN_SOURCE_LABEL,
  churnSeveritySort,
  type ChurnSignal,
  type ChurnSeverity,
} from '@/lib/queries'
import Link from 'next/link'
import ChurnAnalyticsCard from '@/app/components/ChurnAnalyticsCard'
import ChurnAlertBanner from '@/app/components/ChurnAlertBanner'

export const dynamic = 'force-dynamic'

const COUNTRY_NAMES: Record<string, string> = {
  MX: 'México', PE: 'Perú', CL: 'Chile', CO: 'Colombia', AR: 'Argentina', BR: 'Brasil',
}

export default async function ChurnPage() {
  const [signals, counts, trend] = await Promise.all([
    getOpenChurnSignals({ limit: 200 }),
    getChurnOpenCounts(),
    getChurnDailyTrend(30),
  ])

  // Group by group_id, then sort groups by max severity within
  const byGroup = new Map<number, ChurnSignal[]>()
  for (const s of signals) {
    const arr = byGroup.get(s.group_id) ?? []
    arr.push(s)
    byGroup.set(s.group_id, arr)
  }

  const groupBlocks = Array.from(byGroup.entries())
    .map(([gid, list]) => ({
      gid,
      list: list.sort(churnSeveritySort),
      maxRank: Math.max(...list.map((s) => CHURN_SEVERITY_META[s.severity].rank)),
      total: list.length,
      group_name: list[0]?.group_name ?? `Grupo ${gid}`,
      group_country: list[0]?.group_country ?? null,
    }))
    .sort((a, b) => b.maxRank - a.maxRank || b.total - a.total)

  return (
    <div style={{ paddingBottom: 80 }}>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0f172a' }}>Churn Risk</h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
          Señales detectadas de lenguaje agresivo, amenazas de salida y quejas de servicio. Atiende primero las marcadas como
          <strong style={{ color: CHURN_SEVERITY_META.threat_to_leave.color }}> amenaza de salida</strong>.
        </p>
      </div>

      {/* Top metrics card */}
      <ChurnAnalyticsCard counts={counts} trend={trend} />

      {/* Empty state */}
      {signals.length === 0 && (
        <div style={{
          background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12,
          padding: '32px 24px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#15803d' }}>✓ Cero señales abiertas</div>
          <div style={{ fontSize: 13, color: '#166534', marginTop: 6 }}>
            Ningún cliente está mostrando lenguaje de churn ahora mismo.
          </div>
        </div>
      )}

      {/* Per-group blocks */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {groupBlocks.map((block) => {
          const sevCounts = (['threat_to_leave', 'aggressive_language', 'service_complaint'] as ChurnSeverity[])
            .map((s) => ({ s, n: block.list.filter((x) => x.severity === s).length }))
            .filter((x) => x.n > 0)
          return (
            <div
              key={block.gid}
              style={{
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: 14,
                padding: '14px 18px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <Link
                    href={`/grupos/${block.gid}`}
                    style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', textDecoration: 'none' }}
                  >
                    {block.group_name}
                  </Link>
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#64748b' }}>
                    {block.group_country ? COUNTRY_NAMES[block.group_country] ?? block.group_country : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {sevCounts.map(({ s, n }) => {
                    const meta = CHURN_SEVERITY_META[s]
                    return (
                      <span
                        key={s}
                        style={{
                          fontSize: 11, fontWeight: 700, padding: '3px 9px',
                          borderRadius: 999, background: meta.bg, color: meta.color,
                          border: `1px solid ${meta.border}`,
                        }}
                      >{n} {meta.label.toLowerCase()}</span>
                    )
                  })}
                </div>
              </div>

              <ChurnAlertBanner signals={block.list} groupId={block.gid} variant="inline" />
            </div>
          )
        })}
      </div>
    </div>
  )
}
