'use client'

import { useMemo, useState } from 'react'
import type { WeeklyTrendPoint } from '@/lib/queries'

type Metric = 'messages' | 'incidents_opened' | 'resolution_rate' | 'sentiment' | 'avg_ttfr_minutes' | 'avg_ttr_minutes' | 'noise_pct'

const METRIC_META: Record<Metric, {
  label: string
  short: string
  color: string
  unit:  string
  // Higher is better → 'up' (sentiment, resolution_rate, messages with healthy ratio)
  // Lower is better → 'down' (TTFR, noise_pct, incidents_opened)
  direction: 'up' | 'down' | 'neutral'
  desc: string
  fmt:  (v: number | null) => string
}> = {
  messages:         {
    label: 'Mensajes',
    short: 'Volumen',
    color: '#0ea5e9',
    unit:  'msgs',
    direction: 'neutral',
    desc:  'Total de mensajes procesados en la semana.',
    fmt:   (v) => v == null ? '—' : v.toLocaleString('es-MX'),
  },
  incidents_opened: {
    label: 'Incidencias abiertas',
    short: 'Tickets',
    color: '#ef4444',
    unit:  'tickets',
    direction: 'down',
    desc:  'Cuántos tickets se levantaron en la semana.',
    fmt:   (v) => v == null ? '—' : v.toLocaleString('es-MX'),
  },
  resolution_rate:  {
    label: 'Tasa de resolución',
    short: 'Resolución',
    color: '#10b981',
    unit:  '%',
    direction: 'up',
    desc:  'Tickets cerrados ÷ tickets abiertos en la misma semana.',
    fmt:   (v) => v == null ? '—' : `${v}%`,
  },
  sentiment:        {
    label: 'Sentimiento (0-10)',
    short: 'Sentiment',
    color: '#8b5cf6',
    unit:  '/ 10',
    direction: 'up',
    desc:  'Promedio del sentimiento en mensajes de cliente, normalizado 0-10.',
    fmt:   (v) => v == null ? '—' : v.toFixed(1),
  },
  avg_ttfr_minutes: {
    label: 'TTFR promedio',
    short: 'TTFR',
    color: '#f59e0b',
    unit:  'min',
    direction: 'down',
    desc:  'Promedio del tiempo a primera respuesta sustantiva del agente 99. SLA: 30 min.',
    fmt:   (v) => v == null ? '—' : v < 60 ? `${v}m` : `${Math.floor(v / 60)}h ${v % 60}m`,
  },
  avg_ttr_minutes:  {
    label: 'TTR promedio',
    short: 'TTR',
    color: '#db2777',
    unit:  'min',
    direction: 'down',
    desc:  'Promedio del tiempo total a resolución del ticket (apertura → cierre).',
    fmt:   (v) => v == null ? '—' : v < 60 ? `${v}m` : `${Math.floor(v / 60)}h ${v % 60}m`,
  },
  noise_pct:        {
    label: '% Ruido',
    short: 'Ruido',
    color: '#94a3b8',
    unit:  '%',
    direction: 'down',
    desc:  'Mensajes en bucket C (saludos, ruido) sobre el total. Muy alto = grupo no operativo.',
    fmt:   (v) => v == null ? '—' : `${v}%`,
  },
}

function pickColor(metric: Metric, value: number | null): string {
  const meta = METRIC_META[metric]
  if (value == null) return '#94a3b8'
  if (meta.direction === 'neutral') return meta.color
  if (metric === 'avg_ttfr_minutes') return value > 60  ? '#ef4444' : value > 30 ? '#f59e0b' : '#10b981'
  if (metric === 'avg_ttr_minutes')  return value > 240 ? '#ef4444' : value > 90 ? '#f59e0b' : '#10b981'
  if (metric === 'sentiment')        return value >= 7  ? '#10b981' : value >= 5 ? '#f59e0b' : '#ef4444'
  if (metric === 'resolution_rate')  return value >= 80 ? '#10b981' : value >= 50 ? '#f59e0b' : '#ef4444'
  if (metric === 'noise_pct')        return value > 60  ? '#ef4444' : value > 40  ? '#f59e0b' : '#10b981'
  if (metric === 'incidents_opened') return value > 30  ? '#ef4444' : value > 10  ? '#f59e0b' : '#10b981'
  return meta.color
}

function trendArrow(curr: number | null, prev: number | null, direction: 'up' | 'down' | 'neutral'): {
  arrow: string; color: string; deltaPct: number | null
} {
  if (curr == null || prev == null || prev === 0) return { arrow: '·', color: '#94a3b8', deltaPct: null }
  const delta = curr - prev
  if (Math.abs(delta) < 1e-6) return { arrow: '→', color: '#94a3b8', deltaPct: 0 }
  const deltaPct = Math.round((delta / Math.abs(prev)) * 100)
  const goingUp  = delta > 0
  if (direction === 'neutral') {
    return { arrow: goingUp ? '↑' : '↓', color: '#64748b', deltaPct }
  }
  const isGood =
    (direction === 'up'   && goingUp) ||
    (direction === 'down' && !goingUp)
  return {
    arrow:    goingUp ? '↑' : '↓',
    color:    isGood ? '#10b981' : '#ef4444',
    deltaPct,
  }
}

type Props = {
  rows: WeeklyTrendPoint[]
  initialMetric?: Metric
  title?: string
  subtitle?: string
  /** Show the 4w/8w/12w switcher, navigating with `?weeks=`. */
  weeksParam?: number
  showWeeksSwitcher?: boolean
}

export default function MultiWeekTrendCard({
  rows,
  initialMetric = 'incidents_opened',
  title = 'Tendencia multi-semana',
  subtitle,
  weeksParam,
  showWeeksSwitcher = true,
}: Props) {
  const [metric, setMetric] = useState<Metric>(initialMetric)
  const meta = METRIC_META[metric]

  const series = useMemo(() => {
    return rows.map((r) => {
      const value: number | null =
        metric === 'messages'         ? r.messages :
        metric === 'incidents_opened' ? r.incidents_opened :
        metric === 'resolution_rate'  ? r.resolution_rate :
        metric === 'sentiment'        ? r.sentiment :
        metric === 'avg_ttfr_minutes' ? r.avg_ttfr_minutes :
        metric === 'avg_ttr_minutes'  ? r.avg_ttr_minutes :
        metric === 'noise_pct'        ? r.noise_pct :
        null
      return { ...r, value }
    })
  }, [rows, metric])

  const values = series.map((s) => s.value).filter((v): v is number => v != null)
  const maxVal = values.length ? Math.max(...values) : 1
  const minVal = values.length ? Math.min(...values) : 0
  const span   = maxVal - minVal || 1

  // First and last bucket with data → MoM-style delta
  const filled = series.filter((s) => s.value != null)
  const first  = filled[0]?.value ?? null
  const last   = filled[filled.length - 1]?.value ?? null

  const totalMessages   = series.reduce((s, p) => s + p.messages, 0)
  const totalIncidents  = series.reduce((s, p) => s + p.incidents_opened, 0)
  const totalResolved   = series.reduce((s, p) => s + p.incidents_closed, 0)
  const overallResolution = totalIncidents > 0 ? Math.round((totalResolved / totalIncidents) * 100) : null

  const overallTrend = trendArrow(last, first, meta.direction)

  // Sparkline geometry
  const W = 600, H = 90, PAD = 8
  const xStep = series.length > 1 ? (W - PAD * 2) / (series.length - 1) : 0
  const points = series.map((s, i) => {
    if (s.value == null) return null
    const x = PAD + i * xStep
    const y = H - PAD - ((s.value - minVal) / span) * (H - PAD * 2)
    return { x, y, idx: i }
  })
  const linePath = points
    .map((p, i, arr) => {
      if (!p) return ''
      const prev = arr[i - 1]
      return prev ? `L${p.x},${p.y}` : `M${p.x},${p.y}`
    })
    .join(' ')

  return (
    <div style={{
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14,
      overflow: 'hidden', marginBottom: 32,
    }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#0f172a' }}>{title}</h2>
          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
            {subtitle ?? `${rows.length} semana${rows.length === 1 ? '' : 's'} (lunes a domingo) — ${meta.desc}`}
          </p>
        </div>
        {showWeeksSwitcher && (
          <div style={{ display: 'flex', gap: 4 }}>
            {[4, 8, 12].map((w) => {
              const active = (weeksParam ?? rows.length) === w
              const href = `?weeks=${w}`
              return (
                <a
                  key={w}
                  href={href}
                  style={{
                    padding: '5px 11px',
                    borderRadius: 99,
                    border: `1px solid ${active ? '#0f172a' : '#e2e8f0'}`,
                    background: active ? '#0f172a' : '#fff',
                    color: active ? '#fff' : '#475569',
                    fontSize: 11, fontWeight: 700,
                    textDecoration: 'none',
                  }}
                >
                  {w}w
                </a>
              )
            })}
          </div>
        )}
      </div>

      {/* Metric pills */}
      <div style={{ padding: '12px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(Object.keys(METRIC_META) as Metric[]).map((m) => {
          const mm = METRIC_META[m]
          const active = metric === m
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              style={{
                padding: '5px 11px',
                borderRadius: 99,
                border: `1px solid ${active ? mm.color : '#e2e8f0'}`,
                background: active ? `${mm.color}12` : '#fff',
                color: active ? mm.color : '#475569',
                fontSize: 11, fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: mm.color, display: 'inline-block' }} />
              {mm.short}
            </button>
          )
        })}
      </div>

      {/* Top KPI row */}
      <div style={{ padding: '14px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, borderBottom: '1px solid #f1f5f9' }}>
        <Kpi label={meta.label + ' (último)'}        value={meta.fmt(last)}                       hint={`primera sem: ${meta.fmt(first)}`} color={pickColor(metric, last)} />
        <Kpi label="Δ vs primera semana"             value={overallTrend.deltaPct == null ? '—' : `${overallTrend.deltaPct > 0 ? '+' : ''}${overallTrend.deltaPct}%`} arrow={overallTrend.arrow} color={overallTrend.color} hint={meta.direction === 'down' ? 'menor es mejor' : meta.direction === 'up' ? 'mayor es mejor' : ''} />
        <Kpi label="Total mensajes"                  value={totalMessages.toLocaleString('es-MX')} hint={`${rows.length} semanas`} color="#0ea5e9" />
        <Kpi label="Total incidencias"               value={totalIncidents.toLocaleString('es-MX')} hint={overallResolution != null ? `${overallResolution}% resueltas` : 'sin tickets'} color="#ef4444" />
      </div>

      {/* Sparkline */}
      <div style={{ padding: '14px 24px', borderBottom: '1px solid #f1f5f9' }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 90 }}>
          {/* baseline */}
          <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#e2e8f0" strokeWidth={1} />
          {/* path */}
          {points.length > 0 && (
            <path d={linePath} fill="none" stroke={meta.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          )}
          {/* dots */}
          {points.map((p, i) => p && (
            <circle key={i} cx={p.x} cy={p.y} r={3} fill={pickColor(metric, series[p.idx].value)} stroke="#fff" strokeWidth={1.5}>
              <title>{`${series[p.idx].week_label}: ${meta.fmt(series[p.idx].value)}`}</title>
            </circle>
          ))}
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
          <span>{series[0]?.week_label.split(' · ')[0]}</span>
          <span>{series[series.length - 1]?.week_label.split(' · ')[0]}</span>
        </div>
      </div>

      {/* Detail table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f8fafc', color: '#475569' }}>
              <th style={th}>Semana</th>
              <th style={{ ...th, textAlign: 'center' }}>Días</th>
              <th style={{ ...th, textAlign: 'right' }}>Msgs</th>
              <th style={{ ...th, textAlign: 'right' }}>Tickets</th>
              <th style={{ ...th, textAlign: 'right' }}>% Resol.</th>
              <th style={{ ...th, textAlign: 'right' }} title="Tiempo a primera respuesta">TTFR</th>
              <th style={{ ...th, textAlign: 'right' }} title="Tiempo a resolución total">TTR</th>
              <th style={{ ...th, textAlign: 'right' }}>Sentiment</th>
              <th style={{ ...th, textAlign: 'right' }}>Ruido</th>
            </tr>
          </thead>
          <tbody>
            {series.map((p, i) => {
              const prev = series[i - 1]
              const focused = METRIC_META[metric]
              const arr = trendArrow(p.value, prev?.value ?? null, focused.direction)
              const empty = p.days_with_data === 0 && p.messages === 0
              return (
                <tr key={p.week_start} style={{ borderTop: '1px solid #f1f5f9', background: empty ? '#fafafa' : 'transparent' }}>
                  <td style={td}>
                    <div style={{ fontWeight: 600, color: empty ? '#94a3b8' : '#0f172a' }}>{p.week_label}</div>
                  </td>
                  <td style={{ ...td, textAlign: 'center', color: empty ? '#cbd5e1' : '#64748b' }}>
                    {p.days_with_data}/7
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: empty ? '#cbd5e1' : '#0f172a' }}>
                    {p.messages.toLocaleString('es-MX')}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <span style={{ color: pickColor('incidents_opened', p.incidents_opened) }}>
                      {p.incidents_opened}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {p.resolution_rate == null
                      ? <span style={{ color: '#cbd5e1' }}>—</span>
                      : <span style={{ color: pickColor('resolution_rate', p.resolution_rate), fontWeight: 600 }}>
                          {p.resolution_rate}%
                        </span>}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {p.avg_ttfr_minutes == null
                      ? <span style={{ color: '#cbd5e1' }}>—</span>
                      : <span style={{ color: pickColor('avg_ttfr_minutes', p.avg_ttfr_minutes), fontWeight: 600 }}>
                          {METRIC_META.avg_ttfr_minutes.fmt(p.avg_ttfr_minutes)}
                        </span>}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {p.avg_ttr_minutes == null
                      ? <span style={{ color: '#cbd5e1' }}>—</span>
                      : <span style={{ color: pickColor('avg_ttr_minutes', p.avg_ttr_minutes), fontWeight: 600 }}>
                          {METRIC_META.avg_ttr_minutes.fmt(p.avg_ttr_minutes)}
                        </span>}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {p.sentiment == null
                      ? <span style={{ color: '#cbd5e1' }}>—</span>
                      : <span style={{ color: pickColor('sentiment', p.sentiment), fontWeight: 600 }}>
                          {p.sentiment.toFixed(1)}
                        </span>}
                  </td>
                  <td style={{ ...td, textAlign: 'right', position: 'relative' }}>
                    {p.noise_pct == null
                      ? <span style={{ color: '#cbd5e1' }}>—</span>
                      : <span style={{ color: pickColor('noise_pct', p.noise_pct), fontWeight: 600 }}>
                          {p.noise_pct}%
                        </span>}
                    {/* trend hint for the focused metric */}
                    {metric === 'noise_pct' && i > 0 && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: arr.color }}>{arr.arrow}</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div style={{ padding: '10px 24px', background: '#f8fafc', borderTop: '1px solid #f1f5f9', fontSize: 11, color: '#64748b', lineHeight: 1.6 }}>
        Cada semana = lunes a domingo (ISO).
        {' '}<strong>Días</strong> indica cuántos días tienen snapshot — útil para filtrar semanas incompletas.
        {' '}Métrica activa: <strong style={{ color: meta.color }}>{meta.label}</strong> ({meta.direction === 'up' ? 'mayor = mejor' : meta.direction === 'down' ? 'menor = mejor' : 'sólo informativo'}).
      </div>
    </div>
  )
}

function Kpi({ label, value, hint, arrow, color }: {
  label: string
  value: string
  hint?:  string
  arrow?: string
  color:  string
}) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #f1f5f9', borderLeft: `3px solid ${color}`,
      borderRadius: 8, padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: 3,
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 20, fontWeight: 800, color }}>{value}</span>
        {arrow && <span style={{ fontSize: 14, color }}>{arrow}</span>}
      </span>
      {hint && <span style={{ fontSize: 10, color: '#94a3b8' }}>{hint}</span>}
    </div>
  )
}

const th: React.CSSProperties = {
  padding: '10px 14px',
  textAlign: 'left',
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}
const td: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: 12,
}
