'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import type { Participant } from '@/lib/queries'
import { setPrimaryAction } from '@/app/grupos/[id]/actions'

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    agente_99: { bg: 'var(--brand-blue-dim)', color: 'var(--brand-blue)', label: 'Agente 99' },
    cliente:   { bg: 'var(--brand-green-dim)', color: 'var(--brand-green)', label: 'Cliente' },
    otro:      { bg: 'var(--surface-2)', color: 'var(--text-muted)', label: 'Otro' },
  }
  const s = styles[role] ?? styles.otro
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '2px 8px', borderRadius: 999,
      fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

function PrimaryBadge() {
  return (
    <span style={{
      background: '#fef3c7', color: '#b45309',
      padding: '2px 8px', borderRadius: 999,
      fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
      letterSpacing: '0.04em', textTransform: 'uppercase',
      border: '1px solid #fcd34d',
    }}>
      ★ Primario
    </span>
  )
}

export default function ParticipantsList({
  groupId,
  participants: initialParticipants,
}: {
  groupId: number
  participants: Participant[]
}) {
  const [participants, setParticipants] = useState(initialParticipants)
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [, startTransition] = useTransition()
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const unclassifiedCount = participants.filter(p => p.role === 'otro').length
  const primariosCount = participants.filter(p => p.is_primary).length
  const agentesCount = participants.filter(p => p.role === 'agente_99').length

  function togglePrimary(p: Participant) {
    if (p.role !== 'agente_99') {
      setErrorMsg('Solo los agentes 99 pueden marcarse como primarios.')
      return
    }
    setErrorMsg(null)
    setPendingId(p.id)
    startTransition(async () => {
      const next = !p.is_primary
      // Optimistic update
      setParticipants((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, is_primary: next } : x)),
      )
      const res = await setPrimaryAction({ participantId: p.id, isPrimary: next, groupId })
      setPendingId(null)
      if (!res.ok) {
        // Rollback
        setParticipants((prev) =>
          prev.map((x) => (x.id === p.id ? { ...x, is_primary: !next } : x)),
        )
        setErrorMsg(res.error ?? 'Error al actualizar')
      }
    })
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{
        padding: '14px 18px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Participantes</h2>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {participants.length} total · {agentesCount} agentes · {primariosCount} primario{primariosCount === 1 ? '' : 's'}
          </div>
        </div>
        {unclassifiedCount > 0 && (
          <Link
            href={`/onboarding/${groupId}`}
            style={{ fontSize: 11, color: 'var(--orange)', textDecoration: 'none' }}
          >
            {unclassifiedCount} sin clasificar
          </Link>
        )}
      </div>

      {errorMsg && (
        <div style={{
          padding: '8px 18px', fontSize: 11, color: 'var(--danger)',
          background: '#fef2f2', borderBottom: '1px solid var(--border)',
        }}>
          {errorMsg}
        </div>
      )}

      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {participants.map((p) => {
          const canTogglePrimary = p.role === 'agente_99'
          const isPending = pendingId === p.id
          return (
            <div
              key={p.id}
              style={{
                padding: '10px 18px',
                borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 8,
                background: p.is_primary ? '#fffbeb' : undefined,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  fontSize: 13, fontWeight: 500,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{p.display_name ?? p.phone}</span>
                </div>
                {p.display_name && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.phone}</div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {p.is_primary && <PrimaryBadge />}
                <RoleBadge role={p.role} />
                {canTogglePrimary && (
                  <button
                    type="button"
                    onClick={() => togglePrimary(p)}
                    disabled={isPending}
                    title={p.is_primary ? 'Quitar marca de primario' : 'Marcar como agente primario'}
                    style={{
                      fontSize: 14,
                      lineHeight: 1,
                      padding: '4px 7px',
                      borderRadius: 4,
                      border: '1px solid var(--border)',
                      background: p.is_primary ? '#fef3c7' : 'var(--surface-2)',
                      color: p.is_primary ? '#b45309' : 'var(--text-muted)',
                      cursor: isPending ? 'wait' : 'pointer',
                      opacity: isPending ? 0.5 : 1,
                    }}
                  >
                    {p.is_primary ? '★' : '☆'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
