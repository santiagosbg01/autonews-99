import { getGroupsSummary } from '@/lib/queries'
import Link from 'next/link'
import GroupMeta from './components/GroupMeta'

function SentimentBar({ value }: { value: number | null }) {
  if (value === null) return <span style={{ color: 'var(--text-muted)' }}>—</span>
  const pct = Math.round(((value + 1) / 2) * 100)
  const color = value > 0.2 ? 'var(--success)' : value < -0.2 ? 'var(--danger)' : 'var(--warning)'
  return (
    <div className="flex items-center gap-2">
      <div style={{ width: 60, height: 6, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99 }} />
      </div>
      <span style={{ fontSize: 12, color }}>{value > 0 ? '+' : ''}{value.toFixed(2)}</span>
    </div>
  )
}

function StatusDot({ open }: { open: number }) {
  const color = open === 0 ? 'var(--success)' : open <= 2 ? 'var(--warning)' : 'var(--danger)'
  return (
    <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} />
  )
}

function TimeAgo({ ts }: { ts: string | null }) {
  if (!ts) return <span style={{ color: 'var(--text-muted)' }}>Sin mensajes</span>
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  const label = days > 0 ? `hace ${days}d` : hrs > 0 ? `hace ${hrs}h` : mins > 0 ? `hace ${mins}m` : 'ahora'
  return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{label}</span>
}

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const groups = await getGroupsSummary()

  const totalMsgs = groups.reduce((s, g) => s + g.messages_today, 0)
  const totalOpen = groups.reduce((s, g) => s + g.open_incidents, 0)
  const totalProblems = groups.reduce((s, g) => s + g.bucket_b_today, 0)
  const avgTtfr = groups.filter(g => g.avg_ttfr_minutes !== null)
  const globalTtfr = avgTtfr.length > 0
    ? Math.round(avgTtfr.reduce((s, g) => s + (g.avg_ttfr_minutes ?? 0), 0) / avgTtfr.length)
    : null

  return (
    <div style={{ paddingBottom: 120 }}>
      {/* Header */}
      <div className="mb-8" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
            Vista General
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            {groups.length} grupos activos · Hoy {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <Link
          href="/tickets"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '10px 20px', borderRadius: '8px',
            background: 'var(--brand-green)', color: '#fff',
            fontWeight: 700, fontSize: '14px', textDecoration: 'none',
            boxShadow: '0 2px 8px rgba(22,163,74,0.25)',
          }}
        >
          🎫 Ver Tickets
        </Link>
      </div>

      {/* Global stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Mensajes hoy', value: totalMsgs.toLocaleString(), color: 'var(--brand-green)' },
          { label: 'Incidencias abiertas', value: totalOpen, color: totalOpen > 5 ? 'var(--danger)' : totalOpen > 2 ? 'var(--warning)' : 'var(--success)' },
          { label: 'Problemas (Bucket B)', value: totalProblems, color: totalProblems > 10 ? 'var(--danger)' : 'var(--warning)' },
          { label: 'TTFR prom (sem)', value: globalTtfr !== null ? `${globalTtfr} min` : '—', color: globalTtfr !== null && globalTtfr > 30 ? 'var(--danger)' : 'var(--success)' },
        ].map(stat => (
          <div key={stat.label} className="stat-card">
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              {stat.label}
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: stat.color }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Groups table */}
      <div className="card" style={{ padding: 0, overflow: 'visible' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Grupos monitoreados</h2>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', overflow: 'visible' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['', 'Grupo', 'Operación / Cliente', 'Msgs hoy', 'Incidencias', 'Problemas', 'Sentiment', 'TTFR (sem)', 'Último msg', ''].map((h, i) => (
                <th key={i} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', ...(i === 9 ? { width: 90, paddingRight: 20 } : {}) }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                  No hay grupos activos. Agrega el listener a un grupo de WhatsApp.
                </td>
              </tr>
            )}
            {groups.map((g, i) => (
              <tr key={g.id} className="group-row" style={{ borderBottom: i < groups.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <td style={{ padding: '14px 16px', width: 28 }}>
                  <StatusDot open={g.open_incidents} />
                </td>
                <td style={{ padding: '14px 16px' }}>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{g.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {g.pilot_cohort === 'internal' ? 'Interno' : g.pilot_cohort === 'founder_friend' ? 'Piloto' : 'Externo'}
                  </div>
                </td>
                <td style={{ padding: '14px 16px' }}>
                  <GroupMeta groupId={g.id} vertical={g.vertical} clientName={g.client_name} country={g.country} />
                </td>
                <td style={{ padding: '14px 16px', fontSize: 14 }}>{g.messages_today}</td>
                <td style={{ padding: '14px 16px' }}>
                  {g.open_incidents > 0
                    ? <span style={{ color: g.open_incidents > 2 ? 'var(--danger)' : 'var(--warning)', fontWeight: 600 }}>{g.open_incidents} abiertas</span>
                    : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td style={{ padding: '14px 16px' }}>
                  {g.bucket_b_today > 0
                    ? <span style={{ color: 'var(--warning)' }}>{g.bucket_b_today}</span>
                    : <span style={{ color: 'var(--text-muted)' }}>0</span>}
                </td>
                <td style={{ padding: '14px 16px' }}>
                  <SentimentBar value={g.avg_sentiment} />
                </td>
                <td style={{ padding: '14px 16px', fontSize: 13 }}>
                  {g.avg_ttfr_minutes !== null
                    ? <span style={{ color: g.avg_ttfr_minutes > 30 ? 'var(--danger)' : 'var(--success)' }}>{g.avg_ttfr_minutes} min</span>
                    : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td style={{ padding: '14px 16px' }}>
                  <TimeAgo ts={g.last_message_at} />
                </td>
                <td style={{ padding: '14px 20px 14px 8px', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <Link href={`/grupos/${g.id}`}
                      style={{ fontSize: 12, color: 'var(--brand-green)', textDecoration: 'none', padding: '6px 14px', border: '1px solid var(--brand-green)', borderRadius: 6, fontWeight: 600, display: 'inline-block', whiteSpace: 'nowrap' }}>
                      Ver →
                    </Link>
                    <Link href={`/tickets?group=${g.id}`}
                      style={{ fontSize: 12, color: '#6366f1', textDecoration: 'none', padding: '6px 10px', border: '1px solid #6366f1', borderRadius: 6, fontWeight: 600, display: 'inline-block', whiteSpace: 'nowrap' }}>
                      🎫
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
