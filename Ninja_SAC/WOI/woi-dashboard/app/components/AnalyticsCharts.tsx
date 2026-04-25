'use client'

import dynamic from 'next/dynamic'
import type { TimeSeriesPoint } from '@/lib/queries'

const TrendChart = dynamic(() => import('./TrendChart'), { ssr: false })
const TtfrChart  = dynamic(() => import('./TtfrChart'),  { ssr: false })

type Props = {
  data: TimeSeriesPoint[]
  periodLabel: string
}

export default function AnalyticsCharts({ data, periodLabel }: Props) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16, marginBottom: 16 }}>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 2px', color: '#0f172a' }}>Mensajes · Incidencias · Sentiment</h2>
        <p style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 14px' }}>
          Tendencia diaria — {periodLabel}
        </p>
        <TrendChart data={data} />
      </div>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 2px', color: '#0f172a' }}>TTFR y Resolución</h2>
        <p style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 14px' }}>
          Tiempo de respuesta (barras) · % resueltos (línea) · meta 15 min
        </p>
        <TtfrChart data={data} />
      </div>
    </div>
  )
}
