'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { TICKET_STATUS_META } from '@/lib/queries'

const STATUSES = ['abierto', 'respondido', 'pendiente', 'escalado', 'resuelto'] as const
type Status = typeof STATUSES[number]

type Props = {
  ticketId: number
  currentStatus: string
  compact?: boolean
}

export default function StatusChanger({ ticketId, currentStatus, compact = false }: Props) {
  const [open, setOpen]       = useState(false)
  const [status, setStatus]   = useState<Status>((currentStatus as Status) ?? 'abierto')
  const [name, setName]       = useState('')
  const [reason, setReason]   = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const ref                   = useRef<HTMLDivElement>(null)
  const router                = useRouter()

  // Restore saved operator name
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setName(localStorage.getItem('woi_operator') ?? '')
    }
  }, [])

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function save() {
    const operator = name.trim() || 'ops_user'
    localStorage.setItem('woi_operator', operator)
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/tickets/${ticketId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, changed_by: operator, reason: reason.trim() || undefined }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      setOpen(false)
      setReason('')
      router.refresh()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const meta = TICKET_STATUS_META[currentStatus] ?? TICKET_STATUS_META['abierto']

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Cambiar estado"
        style={{
          display:        'inline-flex',
          alignItems:     'center',
          gap:            '4px',
          padding:        compact ? '2px 8px' : '4px 10px',
          borderRadius:   '999px',
          fontSize:       compact ? '11px' : '12px',
          fontWeight:     600,
          border:         `1px solid ${meta.color}40`,
          background:     `${meta.color}18`,
          color:          meta.color,
          cursor:         'pointer',
          whiteSpace:     'nowrap',
        }}
      >
        {meta.label}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ opacity: 0.7 }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        </svg>
      </button>

      {open && (
        <div style={{
          position:    'absolute',
          top:         'calc(100% + 6px)',
          left:        0,
          zIndex:      999,
          background:  '#fff',
          border:      '1px solid #e2e8f0',
          borderRadius:'12px',
          boxShadow:   '0 8px 30px rgba(0,0,0,0.12)',
          padding:     '16px',
          minWidth:    '260px',
        }}>
          <p style={{ fontWeight: 700, fontSize: '13px', color: '#1e293b', marginBottom: '12px' }}>
            Cambiar estado del ticket
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
            {STATUSES.map(s => {
              const m = TICKET_STATUS_META[s]
              const active = status === s
              return (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  style={{
                    display:       'flex',
                    alignItems:    'center',
                    gap:           '8px',
                    padding:       '6px 10px',
                    borderRadius:  '8px',
                    border:        active ? `1.5px solid ${m.color}` : '1.5px solid transparent',
                    background:    active ? `${m.color}15` : '#f8fafc',
                    cursor:        'pointer',
                    textAlign:     'left',
                    fontSize:      '13px',
                    fontWeight:    active ? 700 : 400,
                    color:         active ? m.color : '#475569',
                  }}
                >
                  <span style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: m.color, flexShrink: 0,
                  }} />
                  {m.label}
                </button>
              )
            })}
          </div>

          <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '4px', fontWeight: 600 }}>
            Tu nombre *
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ej. Santiago, Carlos..."
            style={{
              width:        '100%',
              padding:      '6px 10px',
              borderRadius: '8px',
              border:       '1px solid #e2e8f0',
              fontSize:     '13px',
              marginBottom: '8px',
              boxSizing:    'border-box',
            }}
          />

          <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '4px', fontWeight: 600 }}>
            Nota / razón (opcional)
          </label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Motivo del cambio..."
            rows={2}
            style={{
              width:        '100%',
              padding:      '6px 10px',
              borderRadius: '8px',
              border:       '1px solid #e2e8f0',
              fontSize:     '13px',
              resize:       'vertical',
              marginBottom: '10px',
              boxSizing:    'border-box',
            }}
          />

          {error && (
            <p style={{ color: '#ef4444', fontSize: '12px', marginBottom: '8px' }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setOpen(false)}
              style={{
                padding: '6px 14px', borderRadius: '8px',
                border: '1px solid #e2e8f0', background: '#fff',
                fontSize: '12px', cursor: 'pointer', color: '#64748b',
              }}
            >
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={saving || !name.trim()}
              style={{
                padding: '6px 14px', borderRadius: '8px',
                border: 'none', background: saving ? '#94a3b8' : '#16a34a',
                fontSize: '12px', cursor: saving ? 'default' : 'pointer',
                color: '#fff', fontWeight: 700,
              }}
            >
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
