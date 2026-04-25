'use client'

import Link from 'next/link'
import { CHURN_SEVERITY_META, type ChurnDailyPoint } from '@/lib/queries'

type Props = {
  counts: { total: number; threat_to_leave: number; aggressive_language: number; service_complaint: number; groups_affected: number }
  trend: ChurnDailyPoint[]
}

export default function ChurnAnalyticsCard({ counts, trend }: Props) {
  const max = Math.max(1, ...trend.map((t) => t.total))
  const last7 = trend.slice(-7)
  const last7Total = last7.reduce((s, t) => s + t.total, 0)
  const prev7 = trend.slice(-14, -7)
  const prev7Total = prev7.reduce((s, t) => s + t.total, 0)
  const delta = last7Total - prev7Total
  const deltaSign = delta === 0 ? '' : delta > 0 ? '+' : ''
  const deltaColor = delta > 0 ? '#dc2626' : delta < 0 ? '#059669' : '#64748b'

  const accent = counts.threat_to_leave > 0
    ? CHURN_SEVERITY_META.threat_to_leave
    : counts.aggressive_language > 0
      ? CHURN_SEVERITY_META.aggressive_language
      : CHURN_SEVERITY_META.service_complaint

  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${counts.total > 0 ? accent.border : '#e5e7eb'}`,
        borderLeft: `4px solid ${counts.total > 0 ? accent.color : '#cbd5e1'}`,
        borderRadius: 14,
        padding: '18px 22px',
        marginBottom: 24,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>
            Churn Risk Detection
          </div>
          <h3 style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
            {counts.total > 0
              ? `${counts.total} señal${counts.total === 1 ? '' : 'es'} abierta${counts.total === 1 ? '' : 's'} en ${counts.groups_affected} grupo${counts.groups_affected === 1 ? '' : 's'}`
              : 'Sin señales abiertas'}
          </h3>
        </div>
        <Link
          href="/churn"
          style={{
            fontSize: 12, color: '#0369a1', fontWeight: 600, textDecoration: 'none',
            padding: '6px 12px', border: '1px solid #bae6fd', borderRadius: 6,
            background: '#f0f9ff',
          }}
        >Ver todas →</Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) 1.4fr', gap: 14, alignItems: 'stretch' }}>
        {(['threat_to_leave', 'aggressive_language', 'service_complaint'] as const).map((sev) => {
          const m = CHURN_SEVERITY_META[sev]
          const v = counts[sev]
          return (
            <div
              key={sev}
              style={{
                background: v > 0 ? m.bg : '#f8fafc',
                border: `1px solid ${v > 0 ? m.border : '#e2e8f0'}`,
                borderRadius: 8,
                padding: '10px 12px',
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: v > 0 ? m.color : '#94a3b8', letterSpacing: '0.05em' }}>
                {m.label}
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: v > 0 ? m.color : '#cbd5e1', lineHeight: 1.1, marginTop: 4 }}>
                {v}
              </div>
            </div>
          )
        })}

        {/* Sparkline */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>
                Últimos 7 días
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', lineHeight: 1.1, marginTop: 4 }}>
                {last7Total}
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: deltaColor }}>
              {deltaSign}{delta} vs 7d previos
            </div>
          </div>
          <svg width="100%" height={36} viewBox={`0 0 ${trend.length * 6} 36`} preserveAspectRatio="none" style={{ marginTop: 6 }}>
            {trend.map((p, i) => {
              const h = (p.total / max) * 28
              return (
                <rect
                  key={p.date}
                  x={i * 6}
                  y={32 - h}
                  width={4}
                  height={Math.max(1, h)}
                  fill={p.threat_to_leave > 0 ? CHURN_SEVERITY_META.threat_to_leave.color : p.total > 0 ? CHURN_SEVERITY_META.aggressive_language.color : '#cbd5e1'}
                  rx={1}
                />
              )
            })}
          </svg>
        </div>
      </div>
    </div>
  )
}
