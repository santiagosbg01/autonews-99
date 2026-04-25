import {
  getAllTicketsFiltered, getGroupFilters,
  TICKET_STATUS_META, CATEGORY_ES,
  type TicketRow, type TicketStatus,
} from '@/lib/queries'
import { Suspense } from 'react'
import Link from 'next/link'
import TicketFilters from '@/app/components/TicketFilters'
import StatusChanger from '@/app/components/StatusChanger'

export const dynamic = 'force-dynamic'

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtTime(ts: string | null) {
  if (!ts) return null
  return new Date(ts).toLocaleString('es-MX', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Mexico_City',
  })
}

function fmtMin(sec: number | null) {
  if (sec == null) return null
  const m = Math.round(sec / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function elapsedLabel(opened: string): string {
  const ms = Date.now() - new Date(opened).getTime()
  const m  = Math.floor(ms / 60_000)
  if (m < 60)  return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

const URGENCY_META: Record<string, { label: string; color: string; bg: string }> = {
  alta:  { label: 'Alta',  color: '#ef4444', bg: '#fef2f2' },
  media: { label: 'Media', color: '#f59e0b', bg: '#fffbeb' },
  baja:  { label: 'Baja',  color: '#10b981', bg: '#f0fdf4' },
}

// ─── page ────────────────────────────────────────────────────────────────────

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const sp = await searchParams

  const statusFilter   = sp.status   ?? ''
  const groupFilter    = sp.group    ?? ''
  const categoryFilter = sp.category ?? ''
  const urgencyFilter  = sp.urgency  ?? ''

  const [tickets, groups] = await Promise.all([
    getAllTicketsFiltered({
      status:   statusFilter   || undefined,
      groupId:  groupFilter    ? parseInt(groupFilter, 10) : undefined,
      category: categoryFilter || undefined,
      urgency:  urgencyFilter  || undefined,
      limit: 300,
    }),
    getGroupFilters(),
  ])

  // KPI stats (from unfiltered would be ideal, but let's compute from all loaded)
  const allForStats = await getAllTicketsFiltered({ limit: 1000 })

  const byStatus = {
    abierto:    allForStats.filter(t => t.status === 'abierto').length,
    respondido: allForStats.filter(t => t.status === 'respondido').length,
    pendiente:  allForStats.filter(t => t.status === 'pendiente').length,
    escalado:   allForStats.filter(t => t.status === 'escalado').length,
    resuelto:   allForStats.filter(t => t.status === 'resuelto').length,
  }
  const noAck    = allForStats.filter(t => !t.closed_at && !t.first_response_at).length
  const ttfrs    = allForStats.filter(t => t.ttr_seconds != null).map(t => t.ttr_seconds!)
  const avgTtfr  = ttfrs.length > 0 ? Math.round(ttfrs.reduce((a, b) => a + b, 0) / ttfrs.length / 60) : null

  return (
    <div>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <Link href="/analytics" style={{ color: 'var(--text-muted)', fontSize: '13px', textDecoration: 'none' }}>
              ← Dashboard
            </Link>
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
            Tickets de soporte
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Incidencias detectadas automáticamente · actualización horaria
          </p>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          background: '#f0fdf4', border: '1px solid #bbf7d0',
          borderRadius: '8px', padding: '8px 14px',
          fontSize: '12px', color: '#15803d', fontWeight: 600,
        }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
          {tickets.length} resultado{tickets.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* ── KPI cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px', marginBottom: '24px' }}>
        {([
          { label: 'Total',      value: allForStats.length,   color: '#0f172a' },
          { label: 'Escalados',  value: byStatus.escalado,    color: '#ef4444' },
          { label: 'Abiertos',   value: byStatus.abierto,     color: '#f59e0b' },
          { label: 'Pendientes', value: byStatus.pendiente,   color: '#f97316' },
          { label: 'Sin ACK',    value: noAck,                color: noAck > 0 ? '#ef4444' : '#10b981' },
          { label: 'TTFR prom.', value: avgTtfr != null ? `${avgTtfr}m` : '—', color: '#6366f1' },
        ]).map(s => (
          <div key={s.label} style={{
            background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0',
            padding: '16px 20px',
          }}>
            <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '6px', fontWeight: 600 }}>
              {s.label}
            </div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: s.color }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <Suspense>
        <TicketFilters groups={groups} />
      </Suspense>

      {/* ── Ticket board ── */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>

        {/* Table header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '60px 1fr 170px 120px 90px 90px 160px',
          gap: '12px',
          padding: '10px 20px',
          background: '#f8fafc',
          borderBottom: '1px solid #e2e8f0',
          fontSize: '11px', fontWeight: 700, color: '#64748b',
          textTransform: 'uppercase', letterSpacing: '0.07em',
        }}>
          <div>ID</div>
          <div>Tipo · Grupo · Quién levantó</div>
          <div>Abierto · Hace</div>
          <div>ACK 99min</div>
          <div>TTFR</div>
          <div>TTR total</div>
          <div>Estado</div>
        </div>

        {tickets.length === 0 && (
          <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
            Sin tickets con los filtros seleccionados
          </div>
        )}

        {tickets.map((ticket, idx) => (
          <TicketRow
            key={ticket.id}
            ticket={ticket}
            isFirst={idx === 0}
            isLast={idx === tickets.length - 1}
          />
        ))}
      </div>

      <p style={{ marginTop: '12px', fontSize: '12px', color: '#94a3b8', textAlign: 'right' }}>
        Generados por el reconstructor de incidentes · estados actualizados cada hora laboral
      </p>
    </div>
  )
}

// ─── ticket row ───────────────────────────────────────────────────────────────

function TicketRow({ ticket, isFirst, isLast }: {
  ticket: TicketRow
  isFirst: boolean
  isLast: boolean
}) {
  const status    = (ticket.status ?? 'abierto') as TicketStatus
  const statusM   = TICKET_STATUS_META[status]
  const urgM      = URGENCY_META[ticket.urgency ?? 'baja'] ?? URGENCY_META.baja
  const isEscalated = status === 'escalado'

  const elapsed   = elapsedLabel(ticket.opened_at)
  const elapsedH  = (Date.now() - new Date(ticket.opened_at).getTime()) / 3_600_000
  const elapsedColor = elapsedH > 24 ? '#ef4444' : elapsedH > 4 ? '#f59e0b' : '#6b7280'

  return (
    <div style={{
      display:      'grid',
      gridTemplateColumns: '60px 1fr 170px 120px 90px 90px 160px',
      gap:          '12px',
      alignItems:   'center',
      padding:      '14px 20px',
      borderBottom: isLast ? 'none' : '1px solid #f1f5f9',
      borderLeft:   `3px solid ${statusM.color}`,
      background:   isEscalated ? '#fff8f8' : '#fff',
      transition:   'background 0.1s',
    }}>

      {/* ID */}
      <div>
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', fontFamily: 'monospace' }}>
          #{String(ticket.id).padStart(4, '0')}
        </div>
        <div style={{ marginTop: '4px', fontSize: '10px', color: urgM.color, fontWeight: 700 }}>
          {urgM.label}
        </div>
      </div>

      {/* Main info */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
          <Link
            href={`/tickets/${ticket.id}`}
            style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', textDecoration: 'none' }}
          >
            {CATEGORY_ES[ticket.category ?? ''] ?? ticket.category ?? 'Sin categoría'}
          </Link>
          {isEscalated && (
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#ef4444', background: '#fef2f2', padding: '1px 7px', borderRadius: '99px' }}>
              ▲ ESCALADO
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', color: '#64748b', flexWrap: 'wrap' }}>
          <Link
            href={`/grupos/${ticket.group_id}`}
            style={{ color: '#16a34a', textDecoration: 'none', fontWeight: 500 }}
          >
            {ticket.group_name}
          </Link>
          {ticket.client_name && <span style={{ color: '#94a3b8' }}>· {ticket.client_name}</span>}
          {ticket.opener_display_name || ticket.opener_phone ? (
            <>
              <span>·</span>
              <span>👤 {ticket.opener_display_name ?? ticket.opener_phone}</span>
            </>
          ) : null}
          {ticket.summary && (
            <span style={{
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: '220px', fontStyle: 'italic', color: '#94a3b8',
            }}>
              "{ticket.summary}"
            </span>
          )}
        </div>
      </div>

      {/* Abierto · Hace */}
      <div>
        <div style={{ fontSize: '12px', color: '#374151' }}>{fmtTime(ticket.opened_at)}</div>
        {status !== 'resuelto' && (
          <div style={{ fontSize: '11px', fontWeight: 600, color: elapsedColor, marginTop: '2px' }}>
            hace {elapsed}
          </div>
        )}
      </div>

      {/* ACK */}
      <div>
        {ticket.first_response_at ? (
          <div style={{ fontSize: '12px', color: '#10b981', fontWeight: 600 }}>
            {fmtTime(ticket.first_response_at)}
          </div>
        ) : !ticket.closed_at ? (
          <div style={{ fontSize: '12px', color: '#ef4444', fontWeight: 700 }}>Sin respuesta</div>
        ) : (
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>—</div>
        )}
      </div>

      {/* TTFR */}
      <div>
        {ticket.ttr_seconds != null ? (
          <span style={{
            fontSize: '13px', fontWeight: 700,
            color: ticket.ttr_seconds > 1800 ? '#ef4444' : '#10b981',
          }}>
            {fmtMin(ticket.ttr_seconds)}
          </span>
        ) : <span style={{ fontSize: '12px', color: '#94a3b8' }}>—</span>}
      </div>

      {/* TTR total */}
      <div>
        {ticket.ttr_seconds != null ? (
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#6366f1' }}>
            {fmtMin(ticket.ttr_seconds)}
          </span>
        ) : (
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>—</span>
        )}
      </div>

      {/* Estado – StatusChanger client component */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <StatusChanger ticketId={ticket.id} currentStatus={status} compact />
        <Link
          href={`/tickets/${ticket.id}`}
          style={{
            fontSize: '12px', fontWeight: 600, color: '#64748b',
            textDecoration: 'none', whiteSpace: 'nowrap',
            padding: '4px 10px', borderRadius: '6px',
            border: '1px solid #e2e8f0', background: '#f8fafc',
          }}
        >
          Ver →
        </Link>
      </div>

    </div>
  )
}
