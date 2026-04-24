import { getGroupsSummary, getGlobalKPIs, type RangeKey } from '@/lib/queries'
import Link from 'next/link'
import { Suspense } from 'react'
import GroupMeta from './components/GroupMeta'
import DateRangeFilter from './components/DateRangeFilter'

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
  const hrs = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  const label = days > 0 ? `hace ${days}d` : hrs > 0 ? `hace ${hrs}h` : mins > 0 ? `hace ${mins}m` : 'ahora'
  return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{label}</span>
}

// Sentiment 0–10 gauge
function SentimentScore({ value }: { value: number | null }) {
  if (value === null) return <span style={{ color: 'var(--text-muted)', fontSize: 28, fontWeight: 700 }}>—</span>
  const color = value >= 7 ? '#10b981' : value >= 5 ? '#f59e0b' : '#ef4444'
  const emoji  = value >= 7 ? '😊' : value >= 5 ? '😐' : '😟'
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ fontSize: 28, fontWeight: 800, color }}>{value.toFixed(1)}</span>
      <span style={{ fontSize: 18 }}>{emoji}</span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>/10</span>
    </div>
  )
}

// ─── page ────────────────────────────────────────────────────────────────────

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const sp    = await searchParams
  const range = (sp.range ?? 'hoy') as RangeKey
  const from  = sp.from
  const to    = sp.to

  const [groups, kpis] = await Promise.all([
    getGroupsSummary(),
    getGlobalKPIs(range, from, to),
  ])

  const sentimentColor = kpis.avg_sentiment_010 == null ? 'var(--text-muted)'
    : kpis.avg_sentiment_010 >= 7 ? 'var(--success)'
    : kpis.avg_sentiment_010 >= 5 ? 'var(--warning)'
    : 'var(--danger)'

  const ttfrColor = kpis.avg_ttfr_minutes == null ? 'var(--text-muted)'
    : kpis.avg_ttfr_minutes > 30 ? 'var(--danger)' : 'var(--success)'

  return (
    <div style={{ paddingBottom: 120 }}>

      {/* ── Header ── */}
      <div className="mb-6" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
            Vista General
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}
            {' · '}
            <span style={{ color: 'var(--brand-green)', fontWeight: 600 }}>{kpis.range_label}</span>
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

      {/* ── Date range filter ── */}
      <Suspense>
        <DateRangeFilter />
      </Suspense>

      {/* ── KPI cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px', marginBottom: '32px' }}>

        {/* 1. Grupos monitoreados */}
        <div className="stat-card">
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Grupos monitoreados
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--brand-green)', marginBottom: 4 }}>
            {kpis.total_groups}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Grupos activos totales</div>
        </div>

        {/* 2. Mensajes monitoreados */}
        <div className="stat-card">
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Mensajes monitoreados
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--brand-green)', marginBottom: 4 }}>
            {kpis.messages_in_range.toLocaleString()}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{kpis.range_label}</div>
        </div>

        {/* 3. Incidencias abiertas */}
        <Link href={`/tickets?range=${range}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`}
          style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="stat-card" style={{ cursor: 'pointer' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Incidencias abiertas
            </div>
            <div style={{
              fontSize: 28, fontWeight: 800, marginBottom: 4,
              color: kpis.incidents_in_range > 5 ? 'var(--danger)' : kpis.incidents_in_range > 2 ? 'var(--warning)' : 'var(--success)',
            }}>
              {kpis.incidents_in_range}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Tickets creados · {kpis.range_label}</div>
            <div style={{ fontSize: 11, color: 'var(--brand-green)', marginTop: 6, fontWeight: 600 }}>Ver tickets →</div>
          </div>
        </Link>

        {/* 4. Sentiment de clientes */}
        <div className="stat-card">
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Sentiment de clientes
          </div>
          <SentimentScore value={kpis.avg_sentiment_010} />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Promedio · {kpis.range_label}</div>
          {/* Mini bar */}
          {kpis.avg_sentiment_010 != null && (
            <div style={{ marginTop: 8, height: 4, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{
                width: `${(kpis.avg_sentiment_010 / 10) * 100}%`,
                height: '100%', borderRadius: 99,
                background: sentimentColor,
              }} />
            </div>
          )}
        </div>

        {/* 5. TTR promedio */}
        <div className="stat-card">
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            TTR promedio
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: ttfrColor, marginBottom: 4 }}>
            {kpis.avg_ttfr_minutes != null ? `${kpis.avg_ttfr_minutes} min` : '—'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            1ª respuesta de agente 99 · {kpis.range_label}
          </div>
          {kpis.avg_ttfr_minutes != null && (
            <div style={{ fontSize: 11, marginTop: 6, fontWeight: 600, color: ttfrColor }}>
              {kpis.avg_ttfr_minutes <= 10 ? 'Excelente' : kpis.avg_ttfr_minutes <= 30 ? 'Aceptable' : 'Necesita mejora'}
            </div>
          )}
        </div>

      </div>

      {/* ── Groups table ── */}
      <div className="card" style={{ padding: 0, overflow: 'visible' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Grupos monitoreados</h2>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{groups.length} grupos</span>
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
                <td colSpan={10} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
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
