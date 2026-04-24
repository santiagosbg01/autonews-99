'use client'

import { useState } from 'react'
import type { Participant } from '@/lib/queries'

const ROLES = [
  { value: 'cliente',   label: 'Cliente',   color: 'var(--brand-green)', bg: 'var(--brand-green-dim)' },
  { value: 'agente_99', label: 'Agente 99', color: 'var(--brand-blue)',  bg: 'var(--brand-blue-dim)'  },
  { value: 'otro',      label: 'Otro',      color: 'var(--text-muted)',  bg: 'var(--surface-2)'       },
]

async function saveRole(participantId: number, role: string) {
  await fetch('/api/participants/role', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId, role }),
  })
}

function ParticipantRow({ participant }: { participant: Participant }) {
  const [role, setRole] = useState(participant.role)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(participant.confirmed_by_santi)

  async function handleRole(newRole: string) {
    if (newRole === role) return
    setSaving(true)
    setRole(newRole)
    await saveRole(participant.id, newRole)
    setSaved(true)
    setSaving(false)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 20px', borderBottom: '1px solid var(--border)',
      background: !saved ? '#78350f0a' : 'transparent',
      transition: 'background 0.2s'
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
          {participant.display_name ?? participant.phone}
          {!saved && <span style={{ fontSize: 10, background: '#78350f44', color: '#fbbf24', padding: '1px 6px', borderRadius: 999 }}>Sin clasificar</span>}
        </div>
        {participant.display_name && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{participant.phone}</div>
        )}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          Último: {new Date(participant.last_seen_at).toLocaleDateString('es-MX')}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        {ROLES.map(r => (
          <button
            key={r.value}
            onClick={() => handleRole(r.value)}
            disabled={saving}
            style={{
              padding: '5px 12px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s',
              border: role === r.value ? `1px solid ${r.color}` : '1px solid var(--border)',
              background: role === r.value ? r.bg : 'transparent',
              color: role === r.value ? r.color : 'var(--text-muted)',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function ParticipantMapper({ participants, groupId }: { participants: Participant[], groupId: number }) {
  const unclassified = participants.filter(p => !p.confirmed_by_santi)
  const classified = participants.filter(p => p.confirmed_by_santi)

  return (
    <div>
      {unclassified.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: '#78350f11' }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: '#fbbf24' }}>
              Sin clasificar ({unclassified.length})
            </h2>
          </div>
          {unclassified.map(p => <ParticipantRow key={p.id} participant={p} />)}
        </div>
      )}

      {classified.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
            <h2 style={{ fontSize: 14, fontWeight: 600 }}>Clasificados ({classified.length})</h2>
          </div>
          {classified.map(p => <ParticipantRow key={p.id} participant={p} />)}
        </div>
      )}

      {participants.length === 0 && (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
          No hay participantes en este grupo todavía.
        </div>
      )}
    </div>
  )
}
