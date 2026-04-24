'use client'

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { TimeSeriesPoint } from '@/lib/queries'

type Props = {
  data: TimeSeriesPoint[]
  title?: string
}

function formatDate(d: string) {
  const date = new Date(d + 'T12:00:00')
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
      padding: '12px 16px', fontSize: 13, boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
    }}>
      <p style={{ fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>{formatDate(label)}</p>
      {payload.map((p: any) => (
        <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 20, marginBottom: 4 }}>
          <span style={{ color: p.color, fontWeight: 500 }}>{p.name}</span>
          <span style={{ fontWeight: 700, color: '#0f172a' }}>{p.value ?? '—'}</span>
        </div>
      ))}
    </div>
  )
}

export default function TrendChart({ data, title }: Props) {
  if (!data.length) {
    return (
      <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 14 }}>
        Sin datos para el período seleccionado
      </div>
    )
  }

  const chartData = data.map(d => ({
    date: d.date,
    Mensajes: d.messages,
    Incidencias: d.incidents,
    Sentiment: d.sentiment != null ? Number(d.sentiment.toFixed(1)) : null,
    'TTFR (min)': d.ttfr_minutes,
  }))

  return (
    <div>
      {title && (
        <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 16 }}>{title}</div>
      )}
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
          />
          {/* Left axis: counts */}
          <YAxis
            yAxisId="count"
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            width={32}
          />
          {/* Right axis: sentiment 0-10 */}
          <YAxis
            yAxisId="sent"
            orientation="right"
            domain={[0, 10]}
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            iconType="circle"
            iconSize={8}
          />
          <Bar
            yAxisId="count"
            dataKey="Mensajes"
            fill="#dbeafe"
            radius={[3, 3, 0, 0]}
            maxBarSize={32}
          />
          <Bar
            yAxisId="count"
            dataKey="Incidencias"
            fill="#fca5a5"
            radius={[3, 3, 0, 0]}
            maxBarSize={32}
          />
          <Line
            yAxisId="sent"
            type="monotone"
            dataKey="Sentiment"
            stroke="#16a34a"
            strokeWidth={2.5}
            dot={{ r: 3, fill: '#16a34a', strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 24, marginTop: 8, fontSize: 11, color: '#94a3b8', justifyContent: 'center' }}>
        <span>Barras azules = mensajes &nbsp;·&nbsp; Barras rojas = incidencias &nbsp;·&nbsp; Línea verde = sentiment (0-10, eje derecho)</span>
      </div>
    </div>
  )
}
