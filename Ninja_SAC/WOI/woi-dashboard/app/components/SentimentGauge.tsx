type Props = { value: number | null; clientOnly?: boolean }

function getFace(v: number): { emoji: string; label: string; color: string } {
  if (v <= -0.5) return { emoji: '😢', label: 'Muy negativo', color: '#dc2626' }
  if (v <= -0.15) return { emoji: '😟', label: 'Negativo',     color: '#f97316' }
  if (v <   0.15) return { emoji: '😐', label: 'Neutral',      color: '#d97706' }
  if (v <   0.5)  return { emoji: '🙂', label: 'Positivo',     color: '#5a9e2f' }
  return              { emoji: '😄', label: 'Muy positivo',  color: '#16a34a' }
}

export default function SentimentGauge({ value, clientOnly }: Props) {
  if (value === null) {
    return (
      <div style={{ padding: '20px 18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Sin datos de sentimiento aún
      </div>
    )
  }

  const face = getFace(value)
  // pct: 0 = far left (-1), 100 = far right (+1)
  const pct = Math.round(((value + 1) / 2) * 100)

  const stops = [
    { pct: 0,   color: '#dc2626' },
    { pct: 25,  color: '#f97316' },
    { pct: 50,  color: '#d97706' },
    { pct: 75,  color: '#5a9e2f' },
    { pct: 100, color: '#16a34a' },
  ]

  return (
    <div style={{ padding: '16px 18px' }}>
      {clientOnly && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
          Basado en mensajes de clientes analizados
        </div>
      )}

      {/* Face + label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <span style={{ fontSize: 36, lineHeight: 1 }}>{face.emoji}</span>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: face.color }}>{face.label}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Score: <span style={{ color: face.color, fontWeight: 600 }}>{value > 0 ? '+' : ''}{value.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Gradient bar with marker */}
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <div style={{
          height: 10, borderRadius: 99, overflow: 'hidden',
          background: `linear-gradient(to right, ${stops.map(s => `${s.color} ${s.pct}%`).join(', ')})`,
        }} />
        {/* Marker */}
        <div style={{
          position: 'absolute', top: '50%', left: `${pct}%`,
          transform: 'translate(-50%, -50%)',
          width: 16, height: 16, borderRadius: '50%',
          background: 'white', border: `3px solid ${face.color}`,
          boxShadow: `0 0 6px ${face.color}66`,
        }} />
      </div>

      {/* Scale labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
        <span>😢 Muy mal</span>
        <span>😐 Neutral</span>
        <span>Muy bien 😄</span>
      </div>
    </div>
  )
}
