import { getTicketDetail, getTicketStatusLogs, TICKET_STATUS_META, CATEGORY_ES, type TicketStatus } from '@/lib/queries'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import StatusChanger from '@/app/components/StatusChanger'

export const dynamic = 'force-dynamic'

// ─── formatting helpers ──────────────────────────────────────────────────────

function fmtFull(ts: string | null, tz = 'America/Mexico_City') {
  if (!ts) return null
  return new Date(ts).toLocaleString('es-MX', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', timeZone: tz,
  })
}

function fmtShort(ts: string | null, tz = 'America/Mexico_City') {
  if (!ts) return null
  return new Date(ts).toLocaleString('es-MX', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz,
  })
}

function fmtMin(sec: number | null) {
  if (sec === null) return '—'
  const m = Math.round(sec / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function elapsedSince(ts: string) {
  const ms = Date.now() - new Date(ts).getTime()
  const m  = Math.floor(ms / 60_000)
  if (m < 60)  return `${m} minutos`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h} horas ${m % 60} min`
  return `${Math.floor(h / 24)} días ${h % 24} horas`
}

// ─── sub-components ──────────────────────────────────────────────────────────

function InfoRow({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: color ?? '#111827', textAlign: 'right', maxWidth: '60%' }}>{value}</span>
    </div>
  )
}

function TimelineStep({
  label, timestamp, tz, color, done, last,
}: {
  label: string; timestamp: string | null; tz: string
  color: string; done: boolean; last?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: done ? color : '#f3f4f6',
          border: `2px solid ${done ? color : '#e5e7eb'}`,
          fontSize: 13, color: done ? '#fff' : '#9ca3af',
        }}>
          {done ? '✓' : '○'}
        </div>
        {!last && <div style={{ width: 2, flex: 1, minHeight: 24, background: done ? `${color}40` : '#e5e7eb', marginTop: 4 }} />}
      </div>
      <div style={{ paddingTop: 4, paddingBottom: last ? 0 : 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: done ? '#111827' : '#9ca3af' }}>{label}</div>
        {timestamp && done && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{fmtFull(timestamp, tz)}</div>
        )}
        {!done && <div style={{ fontSize: 11, color: '#d1d5db', marginTop: 2 }}>Pendiente</div>}
      </div>
    </div>
  )
}

const ROLE_META: Record<string, { label: string; color: string; bg: string }> = {
  agente_99: { label: 'Agente 99',  color: '#3b82f6', bg: '#eff6ff' },
  cliente:   { label: 'Cliente',    color: '#10b981', bg: '#f0fdf4' },
  otro:      { label: 'Operador',   color: '#6366f1', bg: '#f5f3ff' },
}

const BUCKET_META: Record<string, { color: string; label: string }> = {
  A: { color: '#10b981', label: 'Normal'   },
  B: { color: '#ef4444', label: 'Problema' },
  C: { color: '#9ca3af', label: 'Ruido'    },
}

// ─── page ────────────────────────────────────────────────────────────────────

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ticketId = parseInt(id)
  if (isNaN(ticketId)) notFound()

  const [ticket, logs] = await Promise.all([
    getTicketDetail(ticketId),
    getTicketStatusLogs(ticketId),
  ])
  if (!ticket) notFound()

  const status  = ticket.status as TicketStatus
  const meta    = TICKET_STATUS_META[status]
  const tz      = ticket.group_timezone ?? 'America/Mexico_City'
  const isOpen  = ticket.is_open
  const urgMeta = { alta: '#ef4444', media: '#f59e0b', baja: '#10b981' }[ticket.urgency ?? 'baja']

  const escalatedReason: Record<string, string> = {
    sin_respuesta_alta_urgencia:  'Sin respuesta — urgencia alta',
    sin_respuesta_media_urgencia: 'Sin respuesta — urgencia media',
    manual:                       'Escalado manualmente',
  }

  return (
    <div>
      {/* ── breadcrumb + header ── */}
      <div className="flex items-center gap-3 mb-2">
        <Link href="/tickets" style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none' }}>← Tickets</Link>
        <span style={{ color: 'var(--border)' }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
          #{String(ticket.id).padStart(4, '0')}
        </span>
      </div>

      <div className="flex items-start justify-between mb-6" style={{ gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
              {CATEGORY_ES[ticket.category ?? ''] ?? ticket.category ?? 'Incidencia sin categoría'}
            </h1>
            {ticket.urgency && (
              <span style={{
                fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                color: urgMeta, background: `${urgMeta}18`,
              }}>
                {ticket.urgency.toUpperCase()}
              </span>
            )}
            <StatusChanger ticketId={ticket.id} currentStatus={status} />
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text-muted)' }}>
            <Link href={`/grupos/${ticket.group_id}`} style={{ color: 'var(--brand-green)', textDecoration: 'none', fontWeight: 500 }}>
              {ticket.group_name}
            </Link>
            <span>·</span>
            <span>Abierto: {fmtFull(ticket.opened_at, tz)}</span>
            {isOpen && <span>· <strong style={{ color: meta.color }}>Hace {elapsedSince(ticket.opened_at)}</strong></span>}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24 }}>

        {/* ── LEFT: summary + thread ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Sonnet summary */}
          {ticket.summary && (
            <div className="card" style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                Resumen del incidente
              </div>
              <p style={{ fontSize: 14, color: '#1f2937', lineHeight: 1.75, margin: 0 }}>
                {ticket.summary}
              </p>
            </div>
          )}

          {/* Message thread */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 14, fontWeight: 600 }}>Hilo de mensajes</h2>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ticket.messages.length} mensajes</span>
            </div>
            {ticket.messages.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                Sin mensajes vinculados aún
              </div>
            ) : (
              <div>
                {ticket.messages.map((msg, i) => {
                  const roleMeta = ROLE_META[msg.sender_role ?? 'otro'] ?? ROLE_META.otro
                  const bucketMeta = msg.bucket ? BUCKET_META[msg.bucket] : null
                  const initial = (msg.sender_display_name ?? msg.sender_phone).charAt(0).toUpperCase()
                  const isFirst = msg.urgency === 'alta' || msg.urgency === 'media'
                  return (
                    <div key={msg.id} style={{
                      display: 'flex', gap: 12, padding: '12px 18px',
                      borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                      background: i === 0 ? '#fffbeb' : 'transparent',
                    }}>
                      {/* Avatar */}
                      <div style={{ flexShrink: 0, marginTop: 2 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 700,
                          background: roleMeta.bg, color: roleMeta.color,
                        }}>
                          {initial}
                        </div>
                      </div>
                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
                            {msg.sender_display_name ?? msg.sender_phone}
                          </span>
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 99,
                            background: roleMeta.bg, color: roleMeta.color,
                          }}>
                            {roleMeta.label}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {fmtShort(msg.timestamp, tz)}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: msg.content ? '#374151' : '#9ca3af', marginBottom: 4, lineHeight: 1.6 }}>
                          {msg.content ?? (msg.media_type ? `[${msg.media_type}]` : '—')}
                        </div>
                        {/* classification tags */}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {bucketMeta && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, color: bucketMeta.color, background: `${bucketMeta.color}18` }}>
                              {bucketMeta.label}
                            </span>
                          )}
                          {msg.category && (
                            <span style={{ fontSize: 10, color: '#6b7280', background: '#f3f4f6', padding: '1px 6px', borderRadius: 99 }}>
                              {CATEGORY_ES[msg.category] ?? msg.category}
                            </span>
                          )}
                          {msg.urgency && msg.urgency !== 'baja' && (
                            <span style={{ fontSize: 10, fontWeight: 600, color: msg.urgency === 'alta' ? '#ef4444' : '#f59e0b', background: msg.urgency === 'alta' ? '#fef2f2' : '#fffbeb', padding: '1px 6px', borderRadius: 99 }}>
                              {msg.urgency}
                            </span>
                          )}
                          {msg.sentiment !== null && (
                            <span style={{ fontSize: 10, color: msg.sentiment > 0 ? '#10b981' : msg.sentiment < 0 ? '#ef4444' : '#9ca3af' }}>
                              {msg.sentiment > 0 ? '+' : ''}{Number(msg.sentiment).toFixed(2)}
                            </span>
                          )}
                          {msg.reasoning && (
                            <span style={{ fontSize: 10, color: '#6b7280', fontStyle: 'italic' }} title={msg.reasoning}>
                              💭 {msg.reasoning.slice(0, 60)}{msg.reasoning.length > 60 ? '…' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT sidebar ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Status timeline */}
          <div className="card" style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>
              Ciclo de vida
            </div>
            <TimelineStep label="Abierto"    timestamp={ticket.opened_at}       tz={tz} color="#f59e0b" done={true} />
            <TimelineStep label="Respondido" timestamp={ticket.first_response_at} tz={tz} color="#3b82f6" done={!!ticket.first_response_at} />
            {status === 'escalado' && (
              <TimelineStep label="Escalado" timestamp={ticket.escalated_at}   tz={tz} color="#ef4444" done={true} />
            )}
            {status === 'pendiente' && (
              <TimelineStep label="Pendiente" timestamp={ticket.first_response_at} tz={tz} color="#f97316" done={true} />
            )}
            <TimelineStep label="Resuelto"   timestamp={ticket.closed_at}       tz={tz} color="#10b981" done={!!ticket.closed_at} last />
          </div>

          {/* Ticket metadata */}
          <div className="card" style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
              Detalles del ticket
            </div>
            <InfoRow label="Levantado por"
              value={ticket.owner_name ?? ticket.owner_phone ?? 'Desconocido'} />
            <InfoRow label="Grupo / operación"
              value={<Link href={`/grupos/${ticket.group_id}`} style={{ color: 'var(--brand-green)', textDecoration: 'none' }}>{ticket.group_name}</Link>} />
            <InfoRow label="Tipo de incidencia"
              value={CATEGORY_ES[ticket.category ?? ''] ?? ticket.category ?? '—'} />
            <InfoRow label="Urgencia"
              value={ticket.urgency?.toUpperCase() ?? '—'}
              color={urgMeta} />
            <InfoRow label="Mensajes en hilo" value={String(ticket.message_count)} />
            <InfoRow label="Respondido por"
              value={ticket.first_response_by ?? 'Sin respuesta'}
              color={ticket.first_response_by ? '#10b981' : '#ef4444'} />
            <InfoRow label="TTFR (respuesta)"
              value={fmtMin(ticket.ttfr_seconds)}
              color={ticket.ttfr_seconds != null && ticket.ttfr_seconds > 1800 ? '#ef4444' : '#10b981'} />
            <InfoRow label="TTR (resolución)"
              value={ticket.ttr_seconds != null ? fmtMin(ticket.ttr_seconds) : isOpen ? `Abierto ${elapsedSince(ticket.opened_at)}` : '—'}
              color={ticket.is_open ? meta.color : '#6b7280'} />
            {ticket.sentiment_avg !== null && (
              <InfoRow label="Sentimiento promedio"
                value={`${Number(ticket.sentiment_avg) > 0 ? '+' : ''}${Number(ticket.sentiment_avg).toFixed(2)}`}
                color={Number(ticket.sentiment_avg) > 0 ? '#10b981' : Number(ticket.sentiment_avg) < 0 ? '#ef4444' : '#6b7280'} />
            )}
            {ticket.escalated_reason && (
              <InfoRow label="Razón de escalado"
                value={escalatedReason[ticket.escalated_reason] ?? ticket.escalated_reason}
                color="#ef4444" />
            )}
          </div>

          {/* Audit log */}
          <div className="card" style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>
              Historial de cambios
            </div>
            {logs.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sin cambios registrados</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {logs.map((log, i) => {
                  const toMeta   = TICKET_STATUS_META[log.to_status]   ?? { color: '#6b7280', label: log.to_status,   dot: '●' }
                  const fromMeta = log.from_status ? TICKET_STATUS_META[log.from_status] : null
                  const isLast   = i === logs.length - 1
                  const isManual = log.source === 'manual'
                  return (
                    <div key={log.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', paddingBottom: isLast ? 0 : 14, position: 'relative' }}>
                      {/* Connector line */}
                      {!isLast && (
                        <div style={{
                          position: 'absolute', left: 11, top: 22, bottom: 0,
                          width: 2, background: '#f1f5f9',
                        }} />
                      )}
                      {/* Dot */}
                      <div style={{
                        width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                        background: isManual ? `${toMeta.color}20` : '#f1f5f9',
                        border: `2px solid ${isManual ? toMeta.color : '#e2e8f0'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, color: toMeta.color, zIndex: 1,
                      }}>
                        {isManual ? '✎' : '⚙'}
                      </div>
                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {fromMeta && (
                            <>
                              <span style={{ fontSize: 11, color: fromMeta.color, fontWeight: 600 }}>{fromMeta.label}</span>
                              <span style={{ fontSize: 11, color: '#94a3b8' }}>→</span>
                            </>
                          )}
                          <span style={{
                            fontSize: 11, fontWeight: 700,
                            color: toMeta.color, background: `${toMeta.color}15`,
                            padding: '1px 8px', borderRadius: 99,
                          }}>
                            {toMeta.label}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                          <strong style={{ color: isManual ? '#0f172a' : '#94a3b8' }}>
                            {log.changed_by}
                          </strong>
                          {' · '}
                          {new Date(log.changed_at).toLocaleString('es-MX', {
                            day: 'numeric', month: 'short',
                            hour: '2-digit', minute: '2-digit',
                            timeZone: 'America/Mexico_City',
                          })}
                          {' · '}
                          <span style={{ color: isManual ? '#16a34a' : '#94a3b8' }}>
                            {isManual ? 'Manual' : log.source}
                          </span>
                        </div>
                        {log.reason && (
                          <div style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic', marginTop: 2 }}>
                            "{log.reason}"
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
