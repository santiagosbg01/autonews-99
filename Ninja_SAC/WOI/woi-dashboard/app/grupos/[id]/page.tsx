import { getGroupDetail, getGroupMessages, getGroupParticipants, getGroupIncidents, getGroupKpiHistory, getLatestGroupAnalysis, getGroupCategoryBreakdown, getGroupHealth, getOpenChurnSignals, getGroupMessageMix, getMultiWeekTrend, TICKET_STATUS_META, CATEGORY_ES, type IncidentRow, type TicketStatus } from '@/lib/queries'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import SentimentGauge from '@/app/components/SentimentGauge'
import Interpretaciones from '@/app/components/Interpretaciones'
import GroupAnalysisCard from '@/app/components/GroupAnalysisCard'
import CategoryBreakdown from '@/app/components/CategoryBreakdown'
import HealthScoreCard from '@/app/components/HealthScoreCard'
import ChurnAlertBanner from '@/app/components/ChurnAlertBanner'
import NoiseBar from '@/app/components/NoiseBar'
import MultiWeekTrendCard from '@/app/components/MultiWeekTrendCard'
import BusinessHoursCard from '@/app/components/BusinessHoursCard'
import OperationalContextCard from '@/app/components/OperationalContextCard'

export const dynamic = 'force-dynamic'

function BucketBadge({ bucket }: { bucket: string }) {
  return <span className={`badge badge-${bucket.toLowerCase()}`}>{bucket}</span>
}

function UrgencyBadge({ urgency }: { urgency: string | null }) {
  if (!urgency) return null
  const styles: Record<string, { bg: string; color: string }> = {
    alta:  { bg: '#fef2f2', color: '#ef4444' },
    media: { bg: '#fffbeb', color: '#f59e0b' },
    baja:  { bg: '#f0fdf4', color: '#10b981' },
  }
  const s = styles[urgency] ?? styles.baja
  return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: s.bg, color: s.color }}>{urgency}</span>
}

function TicketStatusBadge({ ticket }: { ticket: IncidentRow }) {
  const status = (ticket.status ?? (ticket.is_open ? 'abierto' : 'resuelto')) as TicketStatus
  const m = TICKET_STATUS_META[status]
  return (
    <span style={{ fontSize: 10, fontWeight: 600, color: m.color, background: m.bg, padding: '2px 8px', borderRadius: 99 }}>
      {m.dot} {m.label}
    </span>
  )
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleString('es-MX', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    agente_99: { bg: 'var(--brand-blue-dim)', color: 'var(--brand-blue)', label: 'Agente 99' },
    cliente:   { bg: 'var(--brand-green-dim)', color: 'var(--brand-green)', label: 'Cliente' },
    otro:      { bg: 'var(--surface-2)', color: 'var(--text-muted)', label: 'Otro' },
  }
  const s = styles[role] ?? styles.otro
  return (
    <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
      {s.label}
    </span>
  )
}

export default async function GroupPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams?: Promise<Record<string, string>>
}) {
  const { id } = await params
  const sp = (await (searchParams ?? Promise.resolve({}))) as Record<string, string>
  const groupId = parseInt(id)
  if (isNaN(groupId)) notFound()

  const weeksRaw = sp.weeks ? parseInt(sp.weeks) : 8
  const weeks    = [4, 8, 12].includes(weeksRaw) ? weeksRaw : 8

  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const [group, messages, participants, incidents, kpiHistory, latestAnalysis, categoryBreakdown, health, churnSignals, mix, weeklyTrend] = await Promise.all([
    getGroupDetail(groupId),
    getGroupMessages(groupId, 60),
    getGroupParticipants(groupId),
    getGroupIncidents(groupId, 15),
    getGroupKpiHistory(groupId, 30),
    getLatestGroupAnalysis(groupId),
    getGroupCategoryBreakdown(groupId, since7d),
    getGroupHealth(groupId),
    getOpenChurnSignals({ groupId, limit: 20 }),
    getGroupMessageMix(groupId, 7),
    getMultiWeekTrend(weeks, groupId),
  ])

  if (!group) notFound()

  const agents = participants.filter(p => p.role === 'agente_99')
  const clients = participants.filter(p => p.role === 'cliente')
  const unclassified = participants.filter(p => p.role === 'otro')
  const openIncidents = incidents.filter(i => i.is_open)
  const analyzedMsgs = messages.filter(m => m.analysis)
  const bucketB = analyzedMsgs.filter(m => m.analysis?.bucket === 'B').length
  const avgSentiment = analyzedMsgs.length > 0
    ? analyzedMsgs.reduce((s, m) => s + (m.analysis?.sentiment ?? 0), 0) / analyzedMsgs.length
    : null

  const clientMsgs = analyzedMsgs.filter(m => m.sender_role === 'cliente' && m.analysis?.sentiment !== null)
  const clientSentiment = clientMsgs.length > 0
    ? clientMsgs.reduce((s, m) => s + (m.analysis?.sentiment ?? 0), 0) / clientMsgs.length
    : avgSentiment

  const sentColor = (v: number | null) =>
    v === null ? 'var(--text-muted)' : v > 0.1 ? 'var(--success)' : v < -0.1 ? 'var(--danger)' : 'var(--warning)'

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/grupos" style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none' }}>← Grupos</Link>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>{group.name}</h1>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            {group.timezone} · Desde {new Date(group.joined_at).toLocaleDateString('es-MX')}
          </div>
          <div style={{ marginTop: 10, maxWidth: 460 }}>
            <NoiseBar mix={mix} variant="detailed" width="100%" />
          </div>
        </div>
        <Link href={`/onboarding/${group.id}`} className="btn-ghost" style={{ fontSize: 13 }}>
          Mapear participantes
        </Link>
      </div>

      {/* Contexto operacional — full-width, arriba para que sea lo primero
          que se edita al entrar a un grupo. Se inyecta a Sonnet en cada
          clasificación / análisis / briefing. */}
      <div style={{ marginBottom: 16 }}>
        <OperationalContextCard
          groupId={group.id}
          groupName={group.name}
          initialContext={group.operational_context}
        />
      </div>

      {/* Churn risk alert (if any open signals) */}
      <ChurnAlertBanner signals={churnSignals} groupId={groupId} variant="banner" />

      {/* Client Health Score */}
      <HealthScoreCard health={health} />

      {/* Multi-week trend (T08) */}
      <MultiWeekTrendCard
        rows={weeklyTrend}
        weeksParam={weeks}
        title={`Tendencia ${weeks} semanas — ${group.name}`}
        initialMetric="incidents_opened"
      />

      {/* Stats row */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Mensajes', value: messages.length, sub: 'últimos 60' },
          { label: 'Incidencias abiertas', value: openIncidents.length, color: openIncidents.length > 0 ? 'var(--warning)' : 'var(--success)' },
          { label: 'Incidencias', value: bucketB, color: bucketB > 5 ? 'var(--danger)' : 'var(--warning)' },
          { label: 'Sentiment prom', value: avgSentiment !== null ? (avgSentiment > 0 ? '+' : '') + avgSentiment.toFixed(2) : '—', color: sentColor(avgSentiment) },
          { label: 'Participantes', value: participants.length, sub: `${agents.length} agentes · ${clients.length} clientes` },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color ?? 'var(--text)' }}>{s.value}</div>
            {s.sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.sub}</div>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Messages feed */}
        <div className="col-span-2">
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: 14, fontWeight: 600 }}>Mensajes recientes</h2>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{messages.length} mensajes</span>
            </div>
            <div style={{ maxHeight: 520, overflowY: 'auto' }}>
              {messages.map(msg => (
                <div key={msg.id} style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12 }}>
                  <div style={{ minWidth: 32, marginTop: 2 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700,
                        background: msg.sender_role === 'agente_99' ? 'var(--brand-blue-dim)' : msg.sender_role === 'cliente' ? 'var(--brand-green-dim)' : 'var(--surface-2)',
                        color: msg.sender_role === 'agente_99' ? 'var(--brand-blue)' : msg.sender_role === 'cliente' ? 'var(--brand-green)' : 'var(--text-muted)',
                    }}>
                      {(msg.sender_display_name ?? msg.sender_phone).charAt(0).toUpperCase()}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{msg.sender_display_name ?? msg.sender_phone}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatTime(msg.timestamp)}</span>
                    </div>
                    <div style={{ fontSize: 13, color: msg.content ? 'var(--text)' : 'var(--text-muted)', marginBottom: msg.analysis ? 6 : 0 }}>
                      {msg.content ?? (msg.media_type ? `[${msg.media_type}]` : '—')}
                    </div>
                    {msg.analysis && (
                      <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
                        <BucketBadge bucket={msg.analysis.bucket} />
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{msg.analysis.category}</span>
                        {msg.analysis.urgency && msg.analysis.urgency !== 'baja' && <UrgencyBadge urgency={msg.analysis.urgency} />}
                        {msg.analysis.sentiment !== null && (
                          <span style={{ fontSize: 11, color: msg.analysis.sentiment > 0 ? 'var(--success)' : msg.analysis.sentiment < 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                            {msg.analysis.sentiment > 0 ? '+' : ''}{msg.analysis.sentiment?.toFixed(2)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-4">
          {/* Open tickets */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 14, fontWeight: 600 }}>Tickets abiertos</h2>
              <Link href="/tickets" style={{ fontSize: 11, color: 'var(--brand-green)', textDecoration: 'none' }}>
                Ver todos →
              </Link>
            </div>
            <div>
              {openIncidents.length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  Sin tickets abiertos ✓
                </div>
              )}
              {openIncidents.map(inc => (
                <Link key={inc.id} href={`/tickets/${inc.id}`} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
                <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', fontFamily: 'monospace' }}>#{String(inc.id).padStart(4, '0')}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                        {CATEGORY_ES[inc.category ?? ''] ?? inc.category ?? 'Sin categoría'}
                      </span>
                    </div>
                    <UrgencyBadge urgency={inc.urgency} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
                    Abierto {formatTime(inc.opened_at)} · {inc.message_count} msgs
                  </div>
                  {inc.first_response_at ? (
                    <div style={{ fontSize: 11, color: '#10b981' }}>
                      ACK: {formatTime(inc.first_response_at)} · TTFR {Math.round((inc.ttfr_seconds ?? 0) / 60)}m
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>Sin respuesta de 99min</div>
                  )}
                  {inc.summary && (
                    <div style={{ marginTop: 5, fontSize: 11, color: 'var(--text-sub)', fontStyle: 'italic', lineHeight: 1.4 }}>
                      {inc.summary}
                    </div>
                  )}
                </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Business hours */}
          <BusinessHoursCard
            groupId={group.id}
            initialStart={group.business_hour_start}
            initialEnd={group.business_hour_end}
            initialDays={group.business_days}
            timezone={group.timezone}
          />

          {/* Participants */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 14, fontWeight: 600 }}>Participantes</h2>
              {unclassified.length > 0 && (
                <Link href={`/onboarding/${group.id}`} style={{ fontSize: 11, color: 'var(--orange)', textDecoration: 'none' }}>
                  {unclassified.length} sin clasificar
                </Link>
              )}
            </div>
            <div style={{ maxHeight: 250, overflowY: 'auto' }}>
              {participants.map(p => (
                <div key={p.id} style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{p.display_name ?? p.phone}</div>
                    {p.display_name && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.phone}</div>}
                  </div>
                  <RoleBadge role={p.role} />
                </div>
              ))}
            </div>
          </div>

          {/* Client Sentiment */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <h2 style={{ fontSize: 14, fontWeight: 600 }}>Sentiment del cliente</h2>
            </div>
            <SentimentGauge value={clientSentiment} clientOnly={clientMsgs.length > 0} />
          </div>
        </div>
      </div>

      {/* Sonnet group analysis + category breakdown — full width */}
      <div style={{ display: 'grid', gridTemplateColumns: latestAnalysis ? '3fr 2fr' : '1fr', gap: 24, marginTop: 24 }}>
        {latestAnalysis && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 14, fontWeight: 600 }}>Análisis de grupo</h2>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Actualizado cada hora laboral</span>
            </div>
            <GroupAnalysisCard analysis={latestAnalysis} />
          </div>
        )}

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 14, fontWeight: 600 }}>Tipos de mensajes (7 días)</h2>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Por categoría</span>
          </div>
          <CategoryBreakdown counts={categoryBreakdown} />
        </div>
      </div>

      {/* All tickets — full width */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 24 }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: 14, fontWeight: 600 }}>Tickets del grupo</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Historial de incidencias detectadas — ID · Tipo · ACK · Resolución</p>
          </div>
          <Link href="/tickets" style={{ fontSize: 12, color: 'var(--brand-green)', textDecoration: 'none', padding: '4px 12px', border: '1px solid var(--brand-green)', borderRadius: 6 }}>
            Ver todos los grupos →
          </Link>
        </div>
        {incidents.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Sin tickets aún. Se generan al correr <code>woi-analyze reconstruct</code>.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  {['ID', 'Tipo de problema', 'Detalle', 'Abierto', 'ACK 99min', 'TTFR', 'Cerrado / TTR', 'Estado'].map((h, i) => (
                    <th key={i} style={{ padding: '9px 16px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {incidents.map(ticket => {
                  const ticketStatus = (ticket.status ?? (ticket.is_open ? 'abierto' : 'resuelto')) as TicketStatus
                  const tsMeta = TICKET_STATUS_META[ticketStatus]
                  return (
                  <tr key={ticket.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
                      <Link href={`/tickets/${ticket.id}`} style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand-green)', fontFamily: 'monospace', textDecoration: 'none' }}>
                        #{String(ticket.id).padStart(4, '0')}
                      </Link>
                    </td>
                    <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: 12, color: 'var(--text)' }}>
                          {CATEGORY_ES[ticket.category ?? ''] ?? ticket.category ?? '—'}
                        </span>
                        <UrgencyBadge urgency={ticket.urgency} />
                      </div>
                    </td>
                    <td style={{ padding: '11px 16px', maxWidth: 300 }}>
                      {ticket.summary ? (
                        <span style={{ fontSize: 12, color: '#374151', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {ticket.summary}
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>{ticket.message_count} msgs</span>
                      )}
                    </td>
                    <td style={{ padding: '11px 16px', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text-sub)' }}>
                      {formatTime(ticket.opened_at)}
                    </td>
                    <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
                      {ticket.first_response_at ? (
                        <span style={{ fontSize: 12, color: '#10b981' }}>{formatTime(ticket.first_response_at)}</span>
                      ) : ticket.is_open ? (
                        <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>Sin respuesta</span>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
                      {ticket.ttfr_seconds !== null ? (
                        <span style={{ fontSize: 12, fontWeight: 600, color: ticket.ttfr_seconds > 1800 ? '#ef4444' : '#10b981' }}>
                          {Math.round(ticket.ttfr_seconds / 60)}m
                        </span>
                      ) : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '11px 16px', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text-sub)' }}>
                      {ticket.closed_at
                        ? <>{formatTime(ticket.closed_at)}{ticket.ttr_seconds !== null && <span style={{ color: 'var(--text-muted)' }}> · {Math.round(ticket.ttr_seconds / 60)}m</span>}</>
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>
                      }
                    </td>
                    <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, color: tsMeta.color, background: tsMeta.bg }}>
                        {tsMeta.dot} {tsMeta.label}
                      </span>
                    </td>
                  </tr>
                )})}
              
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Interpretaciones — full width below */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 24 }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: 14, fontWeight: 600 }}>Interpretaciones de Sonnet</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Lo que el modelo detecta en cada mensaje analizado
            </p>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{analyzedMsgs.filter(m => m.analysis?.reasoning).length} analizados</span>
        </div>
        <Interpretaciones messages={messages} />
      </div>

      {/* KPI snapshot history */}
      {kpiHistory.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 24 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <h2 style={{ fontSize: 14, fontWeight: 600 }}>Historial de KPIs diarios</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Sentiment cliente · % Incidencias · TTFR — últimos 30 días
            </p>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  {['Fecha', 'Msgs', 'Op / Inc / Ruido', '% Incidencias', 'Sentiment cliente', 'TTFR avg', 'TTFR p90', 'TTR avg', 'Riesgo'].map(h => (
                    <th key={h} style={{ padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kpiHistory.map(row => {
                  const ratioB = row.ratio_b !== null ? row.ratio_b * 100 : 0
                  const rBColor = ratioB > 30 ? '#ef4444' : ratioB > 15 ? '#f59e0b' : '#10b981'
                  const sentVal = row.client_sentiment_avg
                  const sentColor = sentVal === null ? '#9ca3af' : sentVal > 0.1 ? '#10b981' : sentVal < -0.1 ? '#ef4444' : '#f59e0b'
                  const fmtMin = (s: number | null) => s === null ? '—' : `${Math.round(s / 60)}m`
                  const riskColor: Record<string, string> = { alto: '#ef4444', medio: '#f59e0b', bajo: '#10b981' }
                  return (
                    <tr key={row.snapshot_date} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '9px 14px', fontSize: 13, color: 'var(--text-sub)', whiteSpace: 'nowrap' }}>
                        {new Date(row.snapshot_date + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' })}
                      </td>
                      <td style={{ padding: '9px 14px', fontSize: 13, fontWeight: 600 }}>{row.total_messages}</td>
                      <td style={{ padding: '9px 14px', fontSize: 12 }}>
                        <span style={{ color: '#10b981' }}>{row.bucket_a}</span>
                        <span style={{ color: '#d1d5db' }}> / </span>
                        <span style={{ color: '#ef4444', fontWeight: row.bucket_b > 0 ? 600 : 400 }}>{row.bucket_b}</span>
                        <span style={{ color: '#d1d5db' }}> / </span>
                        <span style={{ color: '#9ca3af' }}>{row.bucket_c}</span>
                      </td>
                      <td style={{ padding: '9px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 40, height: 5, background: '#e5e7eb', borderRadius: 99, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(ratioB, 100)}%`, height: '100%', background: rBColor, borderRadius: 99 }} />
                          </div>
                          <span style={{ fontSize: 12, color: rBColor, fontWeight: 600 }}>{ratioB.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '9px 14px', fontSize: 13, color: sentColor, fontWeight: 600 }}>
                        {sentVal !== null ? `${sentVal > 0 ? '+' : ''}${sentVal.toFixed(2)}` : '—'}
                      </td>
                      <td style={{ padding: '9px 14px', fontSize: 13, color: row.avg_ttfr_seconds !== null && row.avg_ttfr_seconds > 1800 ? '#ef4444' : '#374151' }}>
                        {fmtMin(row.avg_ttfr_seconds)}
                      </td>
                      <td style={{ padding: '9px 14px', fontSize: 13, color: '#6b7280' }}>
                        {fmtMin(row.p90_ttfr_seconds)}
                      </td>
                      <td style={{ padding: '9px 14px', fontSize: 13, color: '#6b7280' }}>
                        {fmtMin(row.avg_ttr_seconds)}
                      </td>
                      <td style={{ padding: '9px 14px' }}>
                        {row.risk_level ? (
                          <span style={{ fontSize: 11, fontWeight: 600, color: riskColor[row.risk_level] ?? '#9ca3af' }}>
                            {row.risk_level}
                            {row.anomaly_count > 0 && <span style={{ color: '#ef4444' }}> ⚠{row.anomaly_count}</span>}
                          </span>
                        ) : <span style={{ color: '#d1d5db' }}>—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
