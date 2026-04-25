'use client'

import { useState } from 'react'
import { MIX_META, type MessageMix } from '@/lib/queries'

type Variant = 'compact' | 'detailed'

/**
 * 3-segment progress bar showing the share of Operativos / Incidencias / Ruido
 * in a group's classified messages. Includes a hover tooltip with the legend
 * and absolute counts.
 */
export default function NoiseBar({
  mix,
  variant = 'compact',
  width = 120,
}: {
  mix: MessageMix
  variant?: Variant
  width?: number | string
}) {
  const [open, setOpen] = useState(false)

  if (mix.total === 0) {
    return (
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        sin clasificar
      </span>
    )
  }

  const segments = [
    { key: 'operativos' as const, pct: mix.pct_operativos, count: mix.operativos },
    { key: 'incidencias' as const, pct: mix.pct_incidencias, count: mix.incidencias },
    { key: 'ruido' as const, pct: mix.pct_ruido, count: mix.ruido },
  ]
  const dominant = segments.reduce((a, b) => (a.pct >= b.pct ? a : b))

  return (
    <div
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width }}>
        {/* The segmented bar */}
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: variant === 'compact' ? 8 : 12,
            borderRadius: 99,
            overflow: 'hidden',
            background: '#f1f5f9',
            cursor: 'help',
          }}
          aria-label={`Mix: ${mix.pct_operativos}% operativos · ${mix.pct_incidencias}% incidencias · ${mix.pct_ruido}% ruido`}
        >
          {segments.map((s) => {
            const meta = MIX_META[s.key]
            if (s.pct === 0) return null
            return (
              <div
                key={s.key}
                style={{
                  width: `${s.pct}%`,
                  height: '100%',
                  background: meta.color,
                }}
                title={`${meta.label}: ${s.count} (${s.pct}%)`}
              />
            )
          })}
        </div>

        {/* Compact label below: dominant bucket with % */}
        {variant === 'compact' && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: MIX_META[dominant.key].color, fontWeight: 600 }}>
              {dominant.pct}% {MIX_META[dominant.key].label.toLowerCase()}
            </span>
            <span>{mix.total} msgs</span>
          </div>
        )}

        {/* Detailed: 3 inline pills with counts and % */}
        {variant === 'detailed' && (
          <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
            {segments.map((s) => {
              const meta = MIX_META[s.key]
              return (
                <span
                  key={s.key}
                  style={{
                    color: meta.color,
                    fontWeight: 600,
                    padding: '1px 6px',
                    borderRadius: 4,
                    background: meta.bg,
                  }}
                >
                  {s.pct}% {meta.label}
                </span>
              )
            })}
          </div>
        )}
      </div>

      {/* Hover tooltip with legend + counts */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 6,
            zIndex: 50,
            minWidth: 240,
            background: '#0f172a',
            color: '#fff',
            border: '1px solid #334155',
            borderRadius: 8,
            padding: '10px 12px',
            boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 11, letterSpacing: '0.05em', color: '#cbd5e1' }}>
            Mix de mensajes · últimos 7d ({mix.total} clasificados)
          </div>
          {segments.map((s) => {
            const meta = MIX_META[s.key]
            return (
              <div key={s.key} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ color: meta.color, fontWeight: 700 }}>{meta.label}</span>
                  <span style={{ color: '#fff', fontWeight: 600 }}>
                    {s.count} <span style={{ color: '#94a3b8' }}>({s.pct}%)</span>
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 1 }}>{meta.desc}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
