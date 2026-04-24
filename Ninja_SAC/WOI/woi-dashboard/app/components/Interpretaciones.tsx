import type { MessageRow } from '@/lib/queries'

type Props = { messages: MessageRow[] }

const BUCKET_COLORS: Record<string, { bg: string; color: string }> = {
  A: { bg: '#5a9e2f18', color: '#5a9e2f' },
  B: { bg: '#d9770618', color: '#d97706' },
  C: { bg: '#4d65ff15', color: '#4d65ff' },
}

const URGENCY_COLORS: Record<string, string> = {
  alta:  '#dc2626',
  media: '#d97706',
  baja:  '#5a9e2f',
}

function sentimentFace(v: number | null) {
  if (v === null) return null
  if (v <= -0.5) return '😢'
  if (v <= -0.15) return '😟'
  if (v < 0.15)  return '😐'
  if (v < 0.5)   return '🙂'
  return '😄'
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleString('es-MX', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export default function Interpretaciones({ messages }: Props) {
  const interpreted = messages
    .filter(m => m.analysis?.reasoning)
    .slice(0, 8)

  if (interpreted.length === 0) {
    return (
      <div style={{ padding: '20px 18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Aún no hay interpretaciones de Sonnet
      </div>
    )
  }

  return (
    <div>
      {interpreted.map((msg, i) => {
        const a = msg.analysis!
        const bc = BUCKET_COLORS[a.bucket] ?? BUCKET_COLORS.C
        const face = sentimentFace(a.sentiment)
        return (
          <div key={msg.id} style={{
            padding: '14px 18px',
            borderBottom: i < interpreted.length - 1 ? '1px solid var(--border)' : 'none',
          }}>
            {/* Top row: sender + time + badges */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                {msg.sender_display_name ?? msg.sender_phone}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatTime(msg.timestamp)}</span>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999,
                background: bc.bg, color: bc.color,
              }}>
                {a.bucket}
              </span>
              {a.urgency && a.urgency !== 'baja' && (
                <span style={{ fontSize: 10, fontWeight: 600, color: URGENCY_COLORS[a.urgency] ?? 'var(--text-muted)' }}>
                  ↑ {a.urgency}
                </span>
              )}
              {face && <span style={{ fontSize: 13 }}>{face}</span>}
            </div>

            {/* Original message preview */}
            {msg.content && (
              <div style={{
                fontSize: 12, color: 'var(--text-sub)',
                background: 'var(--surface-2)', borderRadius: 6, padding: '6px 10px',
                marginBottom: 6, borderLeft: `3px solid ${bc.color}`,
                fontStyle: 'italic', lineHeight: 1.5,
              }}>
                "{msg.content.length > 120 ? msg.content.slice(0, 120) + '…' : msg.content}"
              </div>
            )}

            {/* Sonnet reasoning */}
            <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--brand-blue)', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 6 }}>
                Sonnet →
              </span>
              {a.reasoning}
            </div>
          </div>
        )
      })}
    </div>
  )
}
