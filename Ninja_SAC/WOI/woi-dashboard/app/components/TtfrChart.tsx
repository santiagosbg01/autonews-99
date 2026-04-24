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
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import type { TimeSeriesPoint } from '@/lib/queries'

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
          <span style={{ fontWeight: 700, color: '#0f172a' }}>
            {p.value != null ? (p.name === 'Resolución %' ? `${p.value}%` : `${p.value}m`) : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function TtfrChart({ data }: { data: TimeSeriesPoint[] }) {
  if (!data.length) {
    return (
      <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 14 }}>
        Sin datos para el período seleccionado
      </div>
    )
  }

  const chartData = data.map(d => ({
    date: d.date,
    'TTFR (min)': d.ttfr_minutes,
    'Resolución %': d.resolution_rate,
  }))

  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="ttfr"
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            width={32}
            label={{ value: 'min', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#cbd5e1', offset: 8 }}
          />
          <YAxis
            yAxisId="rate"
            orientation="right"
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            width={28}
            label={{ value: '%', angle: 90, position: 'insideRight', fontSize: 10, fill: '#cbd5e1', offset: 8 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" iconSize={8} />
          {/* Target line: 15 min TTFR */}
          <ReferenceLine yAxisId="ttfr" y={15} stroke="#10b981" strokeDasharray="4 4" label={{ value: 'meta 15m', fill: '#10b981', fontSize: 10 }} />
          <Bar
            yAxisId="ttfr"
            dataKey="TTFR (min)"
            fill="#fbbf24"
            radius={[3, 3, 0, 0]}
            maxBarSize={32}
          />
          <Line
            yAxisId="rate"
            type="monotone"
            dataKey="Resolución %"
            stroke="#6366f1"
            strokeWidth={2.5}
            dot={{ r: 3, fill: '#6366f1', strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 24, marginTop: 8, fontSize: 11, color: '#94a3b8', justifyContent: 'center' }}>
        <span>Barras amarillas = TTFR promedio &nbsp;·&nbsp; Línea azul = tasa de resolución &nbsp;·&nbsp; Línea verde = meta 15 min</span>
      </div>
    </div>
  )
}
