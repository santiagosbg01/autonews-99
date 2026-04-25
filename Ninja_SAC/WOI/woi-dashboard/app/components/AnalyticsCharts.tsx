import type { TimeSeriesPoint } from '@/lib/queries'

// ----------------------------------------------------------------------------
// Native-SVG analytics charts.
//
// Why native SVG instead of Recharts:
//   Recharts v3 + Next.js 16 (Turbopack + React 19) consistently bails out
//   to client-side rendering and then crashes during hydration with a
//   `useContext` null error, leaving the page blank. Same pattern fixed in
//   MultiWeekTrendCard. No deps, server-rendered, zero hydration risk.
//
// Layout: charts are stacked full-width so each gets enough horizontal real
// estate to show data labels at every meaningful point. The TTFR/TTR chart
// in particular needs detail because it's the operational SLA narrative.
// ----------------------------------------------------------------------------

type Props = {
  data: TimeSeriesPoint[]
  periodLabel: string
}

// Volume chart geometry — full width, modest height.
const V_W = 1100
const V_H = 280
// TTFR/TTR chart — same width, taller so the SLA reference and three series
// don't crowd each other.
const T_W = 1100
const T_H = 360

const PAD_L = 48
const PAD_R = 48
const PAD_T = 24
const PAD_B = 36

function shortDate(s: string) {
  const d = new Date(s + 'T12:00:00')
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
}

function pickXTicks<T>(items: T[], target = 6): number[] {
  if (items.length <= target) return items.map((_, i) => i)
  const step = Math.max(1, Math.floor(items.length / target))
  const out: number[] = []
  for (let i = 0; i < items.length; i += step) out.push(i)
  if (out[out.length - 1] !== items.length - 1) out.push(items.length - 1)
  return out
}

// Pick indices where labels should be drawn so they don't overlap. Allows up
// to ~10 labels regardless of how many data points there are.
function pickLabelTicks<T>(items: T[], target = 10): Set<number> {
  if (items.length <= target) return new Set(items.map((_, i) => i))
  const step = Math.max(1, Math.round(items.length / target))
  const set = new Set<number>()
  for (let i = 0; i < items.length; i += step) set.add(i)
  set.add(items.length - 1)
  return set
}

function buildLinePath(pts: Array<{ x: number; y: number } | null>): string {
  let d = ''
  let pen = false
  for (const p of pts) {
    if (!p) { pen = false; continue }
    d += pen ? `L${p.x.toFixed(1)},${p.y.toFixed(1)} ` : `M${p.x.toFixed(1)},${p.y.toFixed(1)} `
    pen = true
  }
  return d.trim()
}

function buildAreaPath(pts: Array<{ x: number; y: number } | null>, baseY: number): string {
  // Connect non-null segments and close to baseline so it can be filled.
  const segments: Array<Array<{ x: number; y: number }>> = []
  let curr: Array<{ x: number; y: number }> = []
  for (const p of pts) {
    if (!p) {
      if (curr.length) { segments.push(curr); curr = [] }
    } else {
      curr.push(p)
    }
  }
  if (curr.length) segments.push(curr)

  return segments
    .map((seg) => {
      if (seg.length === 0) return ''
      const head = `M${seg[0].x.toFixed(1)},${baseY.toFixed(1)} L${seg[0].x.toFixed(1)},${seg[0].y.toFixed(1)}`
      const mid  = seg.slice(1).map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
      const tail = `L${seg[seg.length - 1].x.toFixed(1)},${baseY.toFixed(1)} Z`
      return [head, mid, tail].filter(Boolean).join(' ')
    })
    .join(' ')
}

// ── CHART 1: Volume (mensajes + incidencias) bars + sentiment line ───────────

function VolumeChart({ data }: { data: TimeSeriesPoint[] }) {
  if (data.length === 0) {
    return (
      <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
        Sin datos para el período seleccionado
      </div>
    )
  }

  const innerW = V_W - PAD_L - PAD_R
  const innerH = V_H - PAD_T - PAD_B
  const baseY  = V_H - PAD_B

  const maxCount = Math.max(
    1,
    ...data.map((d) => Math.max(d.messages, d.incidents)),
  )
  const niceMax = Math.ceil(maxCount / 5) * 5 || 5
  const yCountTicks = [0, niceMax * 0.25, niceMax * 0.5, niceMax * 0.75, niceMax].map(Math.round)

  const xStep = innerW / data.length
  const barW  = Math.max(3, Math.min(18, xStep * 0.38))

  const sentPts = data.map((d, i) => {
    if (d.sentiment == null) return null
    const x = PAD_L + xStep * (i + 0.5)
    const y = PAD_T + (1 - d.sentiment / 10) * innerH
    return { x, y }
  })

  const xTicks = pickXTicks(data, 8)
  const labelTicks = pickLabelTicks(data, 10)

  return (
    <svg
      width="100%"
      height={V_H}
      viewBox={`0 0 ${V_W} ${V_H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      style={{ display: 'block', maxWidth: '100%' }}
    >
      {/* Y grid lines + count axis labels */}
      {yCountTicks.map((t) => {
        const y = PAD_T + (1 - t / niceMax) * innerH
        return (
          <g key={t}>
            <line x1={PAD_L} y1={y} x2={V_W - PAD_R} y2={y} stroke="#f1f5f9" strokeWidth={1} />
            <text x={PAD_L - 8} y={y + 4} fontSize={11} fill="#94a3b8" textAnchor="end" fontFamily="sans-serif">{t}</text>
          </g>
        )
      })}
      {/* Right-axis sentiment ticks (0 / 5 / 10) */}
      {[0, 5, 10].map((t) => {
        const y = PAD_T + (1 - t / 10) * innerH
        return (
          <text key={`s-${t}`} x={V_W - PAD_R + 6} y={y + 4} fontSize={11} fill="#16a34a" textAnchor="start" fontFamily="sans-serif">{t}</text>
        )
      })}

      {/* Bars */}
      {data.map((d, i) => {
        const cx = PAD_L + xStep * (i + 0.5)
        const msgH = (d.messages  / niceMax) * innerH
        const incH = (d.incidents / niceMax) * innerH
        return (
          <g key={d.date}>
            <rect
              x={cx - barW - 1}
              y={baseY - msgH}
              width={barW}
              height={msgH}
              fill="#bfdbfe"
              rx={2}
            >
              <title>{`${shortDate(d.date)} · ${d.messages} mensajes`}</title>
            </rect>
            <rect
              x={cx + 1}
              y={baseY - incH}
              width={barW}
              height={incH}
              fill="#fca5a5"
              rx={2}
            >
              <title>{`${shortDate(d.date)} · ${d.incidents} incidencias`}</title>
            </rect>
          </g>
        )
      })}

      {/* Data labels: messages + incidents at tick positions, sentiment value too */}
      {data.map((d, i) => {
        if (!labelTicks.has(i)) return null
        const cx = PAD_L + xStep * (i + 0.5)
        const msgY = baseY - (d.messages  / niceMax) * innerH - 6
        const incY = baseY - (d.incidents / niceMax) * innerH - 6
        return (
          <g key={`lbl-${i}`}>
            {d.messages > 0 && (
              <text x={cx - barW / 2 - 1} y={msgY} fontSize={10} textAnchor="middle" fill="#1d4ed8" fontWeight={700} fontFamily="sans-serif">
                {d.messages}
              </text>
            )}
            {d.incidents > 0 && (
              <text x={cx + barW / 2 + 1} y={incY} fontSize={10} textAnchor="middle" fill="#b91c1c" fontWeight={700} fontFamily="sans-serif">
                {d.incidents}
              </text>
            )}
          </g>
        )
      })}

      {/* Sentiment line */}
      <path d={buildLinePath(sentPts)} stroke="#16a34a" strokeWidth={2} fill="none" />
      {sentPts.map((p, i) => p && (
        <g key={`sp-${i}`}>
          <circle cx={p.x} cy={p.y} r={3} fill="#16a34a">
            <title>{`${shortDate(data[i].date)} · sentiment ${data[i].sentiment?.toFixed(1)}`}</title>
          </circle>
          {labelTicks.has(i) && (
            <text x={p.x} y={p.y - 7} fontSize={10} textAnchor="middle" fill="#15803d" fontWeight={700} fontFamily="sans-serif">
              {data[i].sentiment?.toFixed(1)}
            </text>
          )}
        </g>
      ))}

      {/* X axis */}
      <line x1={PAD_L} y1={baseY} x2={V_W - PAD_R} y2={baseY} stroke="#e2e8f0" strokeWidth={1} />
      {xTicks.map((idx) => {
        const x = PAD_L + xStep * (idx + 0.5)
        return (
          <text key={`x-${idx}`} x={x} y={V_H - 12} fontSize={11} fill="#94a3b8" textAnchor="middle" fontFamily="sans-serif">
            {shortDate(data[idx].date)}
          </text>
        )
      })}
    </svg>
  )
}

// ── CHART 2: TTFR + TTR area lines + resolution % overlay ────────────────────

function TtfrTtrChart({ data }: { data: TimeSeriesPoint[] }) {
  if (data.length === 0) {
    return (
      <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
        Sin datos para el período seleccionado
      </div>
    )
  }

  const innerW = T_W - PAD_L - PAD_R
  const innerH = T_H - PAD_T - PAD_B
  const baseY  = T_H - PAD_B

  // Combined max for TTFR + TTR so they share the same scale.
  // Anchor at 45 min so SLA (30 min) reference line is always visible.
  const maxMin = Math.max(
    45,
    ...data.map((d) => Math.max(d.ttfr_minutes ?? 0, d.ttr_minutes ?? 0)),
  )
  const niceMax = Math.ceil(maxMin / 15) * 15 || 45                 // round up to multiples of 15 min
  const yTicks  = [0, niceMax * 0.25, niceMax * 0.5, niceMax * 0.75, niceMax].map((v) => Math.round(v))

  const xStep = innerW / data.length
  const xAt   = (i: number) => PAD_L + xStep * (i + 0.5)

  const ttfrPts = data.map((d, i) => d.ttfr_minutes == null ? null : { x: xAt(i), y: PAD_T + (1 - d.ttfr_minutes / niceMax) * innerH })
  const ttrPts  = data.map((d, i) => d.ttr_minutes  == null ? null : { x: xAt(i), y: PAD_T + (1 - d.ttr_minutes  / niceMax) * innerH })
  const resPts  = data.map((d, i) => d.resolution_rate == null ? null : { x: xAt(i), y: PAD_T + (1 - d.resolution_rate / 100) * innerH })

  // SLA line at 30 minutes (matches HEALTH_SLA_TTFR_MIN)
  const slaY = PAD_T + (1 - 30 / niceMax) * innerH
  const xTicks = pickXTicks(data, 8)
  const labelTicks = pickLabelTicks(data, 10)

  return (
    <svg
      width="100%"
      height={T_H}
      viewBox={`0 0 ${T_W} ${T_H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      style={{ display: 'block', maxWidth: '100%' }}
    >
      {/* Y grid + minute axis */}
      {yTicks.map((t) => {
        const y = PAD_T + (1 - t / niceMax) * innerH
        return (
          <g key={`y-${t}`}>
            <line x1={PAD_L} y1={y} x2={T_W - PAD_R} y2={y} stroke="#f1f5f9" strokeWidth={1} />
            <text x={PAD_L - 8} y={y + 4} fontSize={11} fill="#94a3b8" textAnchor="end" fontFamily="sans-serif">{t}m</text>
          </g>
        )
      })}
      {/* Right axis: 0-100% */}
      {[0, 25, 50, 75, 100].map((t) => {
        const y = PAD_T + (1 - t / 100) * innerH
        return (
          <text key={`r-${t}`} x={T_W - PAD_R + 6} y={y + 4} fontSize={11} fill="#0ea5e9" textAnchor="start" fontFamily="sans-serif">{t}%</text>
        )
      })}

      {/* SLA reference line at 30 min */}
      {slaY > PAD_T && slaY < baseY && (
        <g>
          <line x1={PAD_L} y1={slaY} x2={T_W - PAD_R} y2={slaY} stroke="#fb923c" strokeWidth={1.5} strokeDasharray="5 5" />
          <text x={PAD_L + 8} y={slaY - 5} fontSize={10} fill="#fb923c" fontFamily="sans-serif" fontWeight={700}>SLA 30m</text>
        </g>
      )}

      {/* TTR area (shown behind) — pink-tinted */}
      <path d={buildAreaPath(ttrPts, baseY)} fill="rgba(244, 114, 182, 0.18)" />
      <path d={buildLinePath(ttrPts)} stroke="#db2777" strokeWidth={2.5} fill="none" />
      {ttrPts.map((p, i) => p && (
        <g key={`tr-${i}`}>
          <circle cx={p.x} cy={p.y} r={3} fill="#db2777">
            <title>{`${shortDate(data[i].date)} · TTR ${data[i].ttr_minutes}m`}</title>
          </circle>
          {/* TTR label ABOVE the dot (TTR is usually larger → higher on chart) */}
          {labelTicks.has(i) && data[i].ttr_minutes != null && (
            <text x={p.x} y={p.y - 8} fontSize={10} textAnchor="middle" fill="#9d174d" fontWeight={700} fontFamily="sans-serif">
              {data[i].ttr_minutes}m
            </text>
          )}
        </g>
      ))}

      {/* TTFR line — amber */}
      <path d={buildLinePath(ttfrPts)} stroke="#f59e0b" strokeWidth={3} fill="none" />
      {ttfrPts.map((p, i) => p && (
        <g key={`tf-${i}`}>
          <circle cx={p.x} cy={p.y} r={3.4} fill="#f59e0b">
            <title>{`${shortDate(data[i].date)} · TTFR ${data[i].ttfr_minutes}m`}</title>
          </circle>
          {/* TTFR label BELOW the dot to avoid overlap with TTR label above */}
          {labelTicks.has(i) && data[i].ttfr_minutes != null && (
            <text x={p.x} y={p.y + 14} fontSize={10} textAnchor="middle" fill="#b45309" fontWeight={700} fontFamily="sans-serif">
              {data[i].ttfr_minutes}m
            </text>
          )}
        </g>
      ))}

      {/* Resolution % line — sky blue */}
      <path d={buildLinePath(resPts)} stroke="#0ea5e9" strokeWidth={2} fill="none" strokeDasharray="4 4" />
      {resPts.map((p, i) => p && (
        <g key={`rp-${i}`}>
          <circle cx={p.x} cy={p.y} r={2.6} fill="#0ea5e9">
            <title>{`${shortDate(data[i].date)} · resolución ${data[i].resolution_rate}%`}</title>
          </circle>
          {labelTicks.has(i) && data[i].resolution_rate != null && (
            <text x={p.x + 8} y={p.y + 3} fontSize={10} textAnchor="start" fill="#0369a1" fontWeight={700} fontFamily="sans-serif">
              {data[i].resolution_rate}%
            </text>
          )}
        </g>
      ))}

      {/* X axis */}
      <line x1={PAD_L} y1={baseY} x2={T_W - PAD_R} y2={baseY} stroke="#e2e8f0" strokeWidth={1} />
      {xTicks.map((idx) => (
        <text key={`x-${idx}`} x={xAt(idx)} y={T_H - 12} fontSize={11} fill="#94a3b8" textAnchor="middle" fontFamily="sans-serif">
          {shortDate(data[idx].date)}
        </text>
      ))}
    </svg>
  )
}

function LegendDot({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#475569', fontWeight: 500 }}>
      {dashed ? (
        <svg width={20} height={3} style={{ display: 'inline-block' }}>
          <line x1={0} y1={1.5} x2={20} y2={1.5} stroke={color} strokeWidth={2.5} strokeDasharray="4 3" />
        </svg>
      ) : (
        <span style={{ width: 14, height: 4, borderRadius: 2, background: color, display: 'inline-block' }} />
      )}
      {label}
    </span>
  )
}

export default function AnalyticsCharts({ data, periodLabel }: Props) {
  const ttfrCount = data.filter((d) => d.ttfr_minutes != null).length
  const ttrCount  = data.filter((d) => d.ttr_minutes  != null).length
  const ttfrAvg   = ttfrCount > 0
    ? Math.round(data.reduce((s, d) => s + (d.ttfr_minutes ?? 0), 0) / ttfrCount)
    : null
  const ttrAvg    = ttrCount > 0
    ? Math.round(data.reduce((s, d) => s + (d.ttr_minutes ?? 0), 0) / ttrCount)
    : null
  const resCount  = data.filter((d) => d.resolution_rate != null).length
  const resAvg    = resCount > 0
    ? Math.round(data.reduce((s, d) => s + (d.resolution_rate ?? 0), 0) / resCount)
    : null

  const fmtMin = (v: number | null) =>
    v == null ? '—' : v < 60 ? `${v} min` : `${Math.floor(v / 60)}h ${v % 60}m`

  const cardStyle: React.CSSProperties = {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    padding: '20px 24px',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 16 }}>
      {/* CHART 1 — Volume + Sentiment */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <div>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 2px', color: '#0f172a' }}>
              Mensajes · Incidencias · Sentiment
            </h2>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>
              Tendencia diaria — {periodLabel}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <LegendDot color="#bfdbfe" label="Mensajes" />
            <LegendDot color="#fca5a5" label="Incidencias" />
            <LegendDot color="#16a34a" label="Sentiment (0–10, eje der.)" />
          </div>
        </div>
        <VolumeChart data={data} />
      </div>

      {/* CHART 2 — TTFR / TTR / Resolución (full width, taller for detail) */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <div>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 2px', color: '#0f172a' }}>
              TTFR · TTR · Resolución
            </h2>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>
              Tiempos en minutos · % resueltos (eje der.) · meta SLA 30 min
            </p>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <LegendDot color="#f59e0b" label={`TTFR · prom. ${fmtMin(ttfrAvg)}`} />
            <LegendDot color="#db2777" label={`TTR · prom. ${fmtMin(ttrAvg)}`} />
            <LegendDot color="#0ea5e9" label={`Resolución · prom. ${resAvg != null ? `${resAvg}%` : '—'}`} dashed />
          </div>
        </div>
        <TtfrTtrChart data={data} />
      </div>
    </div>
  )
}
