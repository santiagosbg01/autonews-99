import type { TimeSeriesPoint } from '@/lib/queries'

// ----------------------------------------------------------------------------
// Native-SVG analytics charts.
//
// Why native SVG instead of Recharts:
//   Recharts v3 + Next.js 16 (Turbopack + React 19) consistently bails out
//   to client-side rendering and then crashes during hydration with a
//   `useContext` null error, leaving the page blank. Same pattern fixed in
//   MultiWeekTrendCard. No deps, server-rendered, zero hydration risk.
// ----------------------------------------------------------------------------

type Props = {
  data: TimeSeriesPoint[]
  periodLabel: string
}

const W = 760
const H = 220
const PAD_L = 36
const PAD_R = 16
const PAD_T = 12
const PAD_B = 28

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
      <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
        Sin datos para el período seleccionado
      </div>
    )
  }

  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B
  const baseY  = H - PAD_B

  const maxCount = Math.max(
    1,
    ...data.map((d) => Math.max(d.messages, d.incidents)),
  )
  // Round up to a nice value for the y-axis ticks
  const niceMax = Math.ceil(maxCount / 5) * 5 || 5
  const yCountTicks = [0, niceMax * 0.25, niceMax * 0.5, niceMax * 0.75, niceMax].map(Math.round)

  const xStep = innerW / data.length      // bar group width
  const barW  = Math.max(2, Math.min(14, xStep * 0.35))

  // Sentiment line on a 0-10 right axis
  const sentPts = data.map((d, i) => {
    if (d.sentiment == null) return null
    const x = PAD_L + xStep * (i + 0.5)
    const y = PAD_T + (1 - d.sentiment / 10) * innerH
    return { x, y }
  })

  const xTicks = pickXTicks(data, 7)

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" style={{ display: 'block' }}>
      {/* Y grid lines + count axis labels */}
      {yCountTicks.map((t) => {
        const y = PAD_T + (1 - t / niceMax) * innerH
        return (
          <g key={t}>
            <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#f1f5f9" strokeWidth={1} />
            <text x={PAD_L - 6} y={y + 3} fontSize={10} fill="#94a3b8" textAnchor="end" fontFamily="sans-serif">{t}</text>
          </g>
        )
      })}
      {/* Right-axis sentiment ticks (0 / 5 / 10) */}
      {[0, 5, 10].map((t) => {
        const y = PAD_T + (1 - t / 10) * innerH
        return (
          <text key={`s-${t}`} x={W - PAD_R + 4} y={y + 3} fontSize={10} fill="#16a34a" textAnchor="start" fontFamily="sans-serif">{t}</text>
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
              rx={1.5}
            >
              <title>{`${shortDate(d.date)} · ${d.messages} mensajes`}</title>
            </rect>
            <rect
              x={cx + 1}
              y={baseY - incH}
              width={barW}
              height={incH}
              fill="#fca5a5"
              rx={1.5}
            >
              <title>{`${shortDate(d.date)} · ${d.incidents} incidencias`}</title>
            </rect>
          </g>
        )
      })}

      {/* Sentiment line */}
      <path d={buildLinePath(sentPts)} stroke="#16a34a" strokeWidth={2} fill="none" />
      {sentPts.map((p, i) => p && (
        <circle key={`sp-${i}`} cx={p.x} cy={p.y} r={2.5} fill="#16a34a">
          <title>{`${shortDate(data[i].date)} · sentiment ${data[i].sentiment?.toFixed(1)}`}</title>
        </circle>
      ))}

      {/* X axis */}
      <line x1={PAD_L} y1={baseY} x2={W - PAD_R} y2={baseY} stroke="#e2e8f0" strokeWidth={1} />
      {xTicks.map((idx) => {
        const x = PAD_L + xStep * (idx + 0.5)
        return (
          <text key={`x-${idx}`} x={x} y={H - 8} fontSize={10} fill="#94a3b8" textAnchor="middle" fontFamily="sans-serif">
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
      <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
        Sin datos para el período seleccionado
      </div>
    )
  }

  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B
  const baseY  = H - PAD_B

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
  const xTicks = pickXTicks(data, 7)

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" style={{ display: 'block' }}>
      {/* Y grid + minute axis */}
      {yTicks.map((t) => {
        const y = PAD_T + (1 - t / niceMax) * innerH
        return (
          <g key={`y-${t}`}>
            <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#f1f5f9" strokeWidth={1} />
            <text x={PAD_L - 6} y={y + 3} fontSize={10} fill="#94a3b8" textAnchor="end" fontFamily="sans-serif">{t}m</text>
          </g>
        )
      })}
      {/* Right axis: 0-100% */}
      {[0, 50, 100].map((t) => {
        const y = PAD_T + (1 - t / 100) * innerH
        return (
          <text key={`r-${t}`} x={W - PAD_R + 4} y={y + 3} fontSize={10} fill="#0ea5e9" textAnchor="start" fontFamily="sans-serif">{t}%</text>
        )
      })}

      {/* SLA reference line at 30 min */}
      {slaY > PAD_T && slaY < baseY && (
        <g>
          <line x1={PAD_L} y1={slaY} x2={W - PAD_R} y2={slaY} stroke="#fb923c" strokeWidth={1} strokeDasharray="4 4" />
          <text x={PAD_L + 6} y={slaY - 3} fontSize={9} fill="#fb923c" fontFamily="sans-serif" fontWeight={600}>SLA 30m</text>
        </g>
      )}

      {/* TTR area (shown behind) — orange-tinted */}
      <path d={buildAreaPath(ttrPts, baseY)} fill="rgba(244, 114, 182, 0.18)" />
      <path d={buildLinePath(ttrPts)} stroke="#db2777" strokeWidth={2} fill="none" />
      {ttrPts.map((p, i) => p && (
        <circle key={`tr-${i}`} cx={p.x} cy={p.y} r={2.4} fill="#db2777">
          <title>{`${shortDate(data[i].date)} · TTR ${data[i].ttr_minutes}m`}</title>
        </circle>
      ))}

      {/* TTFR line — amber */}
      <path d={buildLinePath(ttfrPts)} stroke="#f59e0b" strokeWidth={2.5} fill="none" />
      {ttfrPts.map((p, i) => p && (
        <circle key={`tf-${i}`} cx={p.x} cy={p.y} r={2.6} fill="#f59e0b">
          <title>{`${shortDate(data[i].date)} · TTFR ${data[i].ttfr_minutes}m`}</title>
        </circle>
      ))}

      {/* Resolution % line — sky blue */}
      <path d={buildLinePath(resPts)} stroke="#0ea5e9" strokeWidth={2} fill="none" strokeDasharray="3 3" />
      {resPts.map((p, i) => p && (
        <circle key={`rp-${i}`} cx={p.x} cy={p.y} r={2} fill="#0ea5e9">
          <title>{`${shortDate(data[i].date)} · resolución ${data[i].resolution_rate}%`}</title>
        </circle>
      ))}

      {/* X axis */}
      <line x1={PAD_L} y1={baseY} x2={W - PAD_R} y2={baseY} stroke="#e2e8f0" strokeWidth={1} />
      {xTicks.map((idx) => (
        <text key={`x-${idx}`} x={xAt(idx)} y={H - 8} fontSize={10} fill="#94a3b8" textAnchor="middle" fontFamily="sans-serif">
          {shortDate(data[idx].date)}
        </text>
      ))}
    </svg>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#475569' }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
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

  const fmtMin = (v: number | null) =>
    v == null ? '—' : v < 60 ? `${v} min` : `${Math.floor(v / 60)}h ${v % 60}m`

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16, marginBottom: 16 }}>
      {/* CHART 1 */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 2px', color: '#0f172a' }}>
          Mensajes · Incidencias · Sentiment
        </h2>
        <p style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 12px' }}>
          Tendencia diaria — {periodLabel}
        </p>
        <VolumeChart data={data} />
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <LegendDot color="#bfdbfe" label="Mensajes" />
          <LegendDot color="#fca5a5" label="Incidencias" />
          <LegendDot color="#16a34a" label="Sentiment (0-10, eje der.)" />
        </div>
      </div>

      {/* CHART 2 */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 2px', color: '#0f172a' }}>
          TTFR · TTR · Resolución
        </h2>
        <p style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 12px' }}>
          Tiempos en minutos · % resueltos (eje der.) · meta SLA 30 min
        </p>
        <TtfrTtrChart data={data} />
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <LegendDot color="#f59e0b" label={`TTFR ${fmtMin(ttfrAvg)}`} />
          <LegendDot color="#db2777" label={`TTR ${fmtMin(ttrAvg)}`} />
          <LegendDot color="#0ea5e9" label="Resolución %" />
        </div>
      </div>
    </div>
  )
}
