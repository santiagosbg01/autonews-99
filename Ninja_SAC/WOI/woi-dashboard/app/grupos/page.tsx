import { getGroupsSummary, MIX_META } from '@/lib/queries'
import Link from 'next/link'
import GroupMeta from '../components/GroupMeta'
import HealthScoreBadge from '../components/HealthScoreBadge'
import NoiseBar from '../components/NoiseBar'

export const dynamic = 'force-dynamic'

// ─── helpers ────────────────────────────────────────────────────────────────

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
  const hrs  = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  const label = days > 0 ? `hace ${days}d` : hrs > 0 ? `hace ${hrs}h` : mins > 0 ? `hace ${mins}m` : 'ahora'
  return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{label}</span>
}

// ─── page ────────────────────────────────────────────────────────────────────

export default async function GruposPage() {
  const groups = await getGroupsSummary()

  const fmtMin = (v: number | null) =>
    v == null ? '—' : v < 60 ? `${v} min` : `${Math.floor(v / 60)}h ${v % 60}m`

  return (
    <div style={{ paddingBottom: 120 }}>

      {/* ── Header ── */}
      <div className="mb-6" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
            Grupos
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            Listado completo de grupos monitoreados — KPIs ejecutivos en{' '}
            <Link href="/analytics" style={{ color: 'var(--brand-green)', fontWeight: 600 }}>Analytics →</Link>
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

      {/* ── Groups table ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Grupos monitoreados</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* Mix legend */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--text-muted)' }}>
              <span style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mix (7d):</span>
              {(['operativos', 'incidencias', 'ruido'] as const).map((k) => (
                <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title={MIX_META[k].desc}>
                  <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: MIX_META[k].color }} />
                  {MIX_META[k].label}
                </span>
              ))}
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{groups.length} grupos</span>
          </div>
        </div>

        {/* Horizontal scroll wrapper — keeps the table inside the card on narrow viewports */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 1280, borderCollapse: 'collapse', tableLayout: 'auto' }}>
            <colgroup>
              <col style={{ width: 24 }} />                                   {/* status dot */}
              <col />                                                         {/* grupo */}
              <col style={{ width: 90 }} />                                   {/* health */}
              <col />                                                         {/* operación / cliente */}
              <col style={{ width: 70 }} />                                   {/* msgs hoy */}
              <col style={{ width: 100 }} />                                  {/* incidencias */}
              <col style={{ width: 130 }} />                                  {/* mix */}
              <col style={{ width: 130 }} />                                  {/* sentiment */}
              <col style={{ width: 80 }} />                                   {/* ttfr */}
              <col style={{ width: 80 }} />                                   {/* ttr */}
              <col style={{ width: 90 }} />                                   {/* último */}
              <col style={{ width: 120 }} />                                  {/* acciones */}
            </colgroup>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['', 'Grupo', 'Health', 'Operación / Cliente', 'Msgs hoy', 'Incidencias', 'Mix (7d)', 'Sentiment', 'TTFR (sem)', 'TTR (sem)', 'Último', ''].map((h, i) => (
                  <th
                    key={i}
                    style={{
                      padding: '10px 10px',
                      textAlign: 'left',
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      whiteSpace: 'nowrap',
                      ...(i === 0 ? { paddingLeft: 20 } : {}),
                      ...(i === 11 ? { paddingRight: 20 } : {}),
                    }}
                    title={h === 'TTFR (sem)' ? 'Tiempo a primera respuesta del agente 99 (últimos 7 días). SLA 30m.'
                         : h === 'TTR (sem)'  ? 'Tiempo total a resolución del ticket (últimos 7 días, sólo cerrados).'
                         : undefined}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && (
                <tr>
                  <td colSpan={12} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                    No hay grupos activos. Agrega el listener a un grupo de WhatsApp.
                  </td>
                </tr>
              )}
              {groups.map((g, i) => (
                <tr key={g.id} className="group-row" style={{ borderBottom: i < groups.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <td style={{ padding: '14px 10px 14px 20px' }}>
                    <StatusDot open={g.open_incidents} />
                  </td>
                  <td style={{ padding: '14px 10px' }}>
                    <div style={{ fontWeight: 500, fontSize: 14, lineHeight: 1.3 }}>{g.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {g.pilot_cohort === 'internal' ? 'Interno' : g.pilot_cohort === 'founder_friend' ? 'Piloto' : 'Externo'}
                    </div>
                  </td>
                  <td style={{ padding: '14px 10px' }}>
                    <HealthScoreBadge health={g.health} />
                  </td>
                  <td style={{ padding: '14px 10px' }}>
                    <GroupMeta groupId={g.id} vertical={g.vertical} clientName={g.client_name} country={g.country} />
                  </td>
                  <td style={{ padding: '14px 10px', fontSize: 14 }}>{g.messages_today}</td>
                  <td style={{ padding: '14px 10px' }}>
                    {g.open_incidents > 0
                      ? <span style={{ color: g.open_incidents > 2 ? 'var(--danger)' : 'var(--warning)', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>{g.open_incidents} abiertas</span>
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '14px 10px' }}>
                    <NoiseBar mix={g.mix} variant="compact" width={110} />
                  </td>
                  <td style={{ padding: '14px 10px' }}>
                    <SentimentBar value={g.avg_sentiment} />
                  </td>
                  <td style={{ padding: '14px 10px', fontSize: 13, whiteSpace: 'nowrap' }}>
                    {g.avg_ttfr_minutes !== null
                      ? <span style={{ color: g.avg_ttfr_minutes > 30 ? 'var(--danger)' : 'var(--success)', fontWeight: 500 }}>{fmtMin(g.avg_ttfr_minutes)}</span>
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '14px 10px', fontSize: 13, whiteSpace: 'nowrap' }}>
                    {g.avg_ttr_minutes !== null
                      ? <span style={{
                          color: g.avg_ttr_minutes > 240 ? 'var(--danger)'
                               : g.avg_ttr_minutes > 90  ? 'var(--warning)'
                               : 'var(--success)',
                          fontWeight: 500,
                        }}>{fmtMin(g.avg_ttr_minutes)}</span>
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '14px 10px', whiteSpace: 'nowrap' }}>
                    <TimeAgo ts={g.last_message_at} />
                  </td>
                  <td style={{ padding: '14px 20px 14px 10px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                      <Link href={`/grupos/${g.id}`}
                        style={{ fontSize: 12, color: 'var(--brand-green)', textDecoration: 'none', padding: '5px 12px', border: '1px solid var(--brand-green)', borderRadius: 6, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        Ver →
                      </Link>
                      <Link href={`/tickets?group=${g.id}`}
                        title="Ver tickets de este grupo"
                        style={{ fontSize: 12, color: '#6366f1', textDecoration: 'none', padding: '5px 8px', border: '1px solid #6366f1', borderRadius: 6, fontWeight: 600, whiteSpace: 'nowrap' }}>
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
    </div>
  )
}
