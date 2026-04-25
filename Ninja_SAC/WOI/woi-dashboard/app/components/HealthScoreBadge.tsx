'use client'

import { useState } from 'react'
import type { HealthScore } from '@/lib/queries'

const BAND_STYLE: Record<HealthScore['band'], { color: string; bg: string; border: string; label: string }> = {
  critical: { color: '#7f1d1d', bg: '#fef2f2', border: '#fecaca', label: 'Crítico' },
  warning:  { color: '#b45309', bg: '#fffbeb', border: '#fed7aa', label: 'Atención' },
  watch:    { color: '#0369a1', bg: '#eff6ff', border: '#bfdbfe', label: 'Watch' },
  healthy:  { color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0', label: 'Saludable' },
}

/**
 * Compact 0-100 health score badge with a hover tooltip showing the
 * 4-component breakdown. Use in dense lists / table cells.
 */
export default function HealthScoreBadge({
  health,
  size = 'md',
}: {
  health: HealthScore
  size?: 'sm' | 'md'
}) {
  const [open, setOpen] = useState(false)
  const style = BAND_STYLE[health.band]
  const dim = size === 'sm' ? 36 : 44

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div style={{
        width: dim, height: dim, borderRadius: '50%',
        background: style.bg, border: `2px solid ${style.color}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, color: style.color, fontSize: size === 'sm' ? 12 : 13,
        flexShrink: 0,
      }}>
        {health.total}
      </div>
      {size !== 'sm' && (
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: style.color, letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}>
            {style.label}
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>Health 7d</div>
        </div>
      )}

      {open && (
        <div style={{
          position: 'absolute',
          top: dim + 8,
          left: 0,
          zIndex: 50,
          background: '#fff',
          border: '1px solid #e2e8f0',
          boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
          borderRadius: 10,
          padding: 12,
          minWidth: 250,
          fontSize: 11,
          color: '#0f172a',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
            Client Health Score · {health.total}/100
          </div>
          <Row label="Sentiment"   weight={40} value={health.sentiment}   />
          <Row label="Resolución"  weight={30} value={health.resolution}  />
          <Row label="TTFR vs SLA" weight={20} value={health.ttfr}        />
          <Row label="Escaladas"   weight={10} value={health.escalations} />
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 8, lineHeight: 1.4 }}>
            Ventana: últimos 7 días. SLA TTFR: {health.inputs.sla_ttfr_minutes} min.
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, weight, value }: { label: string; weight: number; value: number }) {
  const color = value >= 80 ? '#15803d' : value >= 60 ? '#0369a1' : value >= 45 ? '#b45309' : '#dc2626'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <div style={{ width: 80, fontSize: 11, color: '#475569' }}>{label}</div>
      <div style={{ width: 22, fontSize: 9, color: '#94a3b8' }}>{weight}%</div>
      <div style={{ flex: 1, height: 5, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, height: '100%', background: color, borderRadius: 99 }} />
      </div>
      <div style={{ width: 28, fontSize: 11, color, fontWeight: 700, textAlign: 'right' }}>
        {value}
      </div>
    </div>
  )
}
