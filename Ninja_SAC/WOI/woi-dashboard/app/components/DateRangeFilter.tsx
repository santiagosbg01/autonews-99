'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useState } from 'react'

export type DateRange = { from: string; to: string }

const SHORTCUTS = [
  { key: 'hoy',    label: 'Hoy'  },
  { key: 'semana', label: 'Semana' },
  { key: 'mes',    label: 'Mes'  },
  { key: 'todos',  label: 'Todos' },
] as const

export default function DateRangeFilter() {
  const router   = useRouter()
  const pathname = usePathname()
  const params   = useSearchParams()

  const activeRange = params.get('range') ?? 'hoy'
  const customFrom  = params.get('from') ?? ''
  const customTo    = params.get('to')   ?? ''

  const [from, setFrom] = useState(customFrom)
  const [to,   setTo]   = useState(customTo)

  function applyShortcut(key: string) {
    const next = new URLSearchParams()
    next.set('range', key)
    router.push(`${pathname}?${next.toString()}`)
  }

  function applyCustom() {
    if (!from || !to) return
    const next = new URLSearchParams()
    next.set('range', 'custom')
    next.set('from', from)
    next.set('to', to)
    router.push(`${pathname}?${next.toString()}`)
  }

  const isCustom = activeRange === 'custom'

  const pillStyle = (active: boolean): React.CSSProperties => ({
    padding:      '6px 16px',
    borderRadius: '8px',
    border:       `1.5px solid ${active ? '#16a34a' : '#e2e8f0'}`,
    background:   active ? '#f0fdf4' : '#fff',
    color:        active ? '#15803d' : '#475569',
    fontWeight:   active ? 700 : 500,
    fontSize:     '13px',
    cursor:       'pointer',
    whiteSpace:   'nowrap' as const,
    transition:   'all 0.1s',
  })

  const inputStyle: React.CSSProperties = {
    padding:      '6px 10px',
    borderRadius: '8px',
    border:       '1.5px solid #e2e8f0',
    fontSize:     '13px',
    color:        '#374151',
    outline:      'none',
    cursor:       'pointer',
  }

  return (
    <div style={{
      display:      'flex',
      alignItems:   'center',
      gap:          '8px',
      flexWrap:     'wrap',
      padding:      '12px 20px',
      background:   '#fff',
      borderRadius: '12px',
      border:       '1px solid #e2e8f0',
      marginBottom: '24px',
    }}>
      <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', marginRight: '4px' }}>
        Período
      </span>

      {SHORTCUTS.map(s => (
        <button key={s.key} onClick={() => applyShortcut(s.key)} style={pillStyle(activeRange === s.key && !isCustom)}>
          {s.label}
        </button>
      ))}

      <div style={{ width: 1, height: 20, background: '#e2e8f0', margin: '0 4px' }} />

      <span style={{ fontSize: '12px', color: '#64748b' }}>Desde</span>
      <input
        type="date"
        value={from}
        onChange={e => setFrom(e.target.value)}
        style={{ ...inputStyle, ...(isCustom && from ? { borderColor: '#16a34a' } : {}) }}
      />
      <span style={{ fontSize: '12px', color: '#64748b' }}>Hasta</span>
      <input
        type="date"
        value={to}
        onChange={e => setTo(e.target.value)}
        style={{ ...inputStyle, ...(isCustom && to ? { borderColor: '#16a34a' } : {}) }}
      />
      <button
        onClick={applyCustom}
        disabled={!from || !to}
        style={{
          padding:      '6px 14px',
          borderRadius: '8px',
          border:       'none',
          background:   from && to ? '#16a34a' : '#e2e8f0',
          color:        from && to ? '#fff' : '#94a3b8',
          fontSize:     '13px',
          fontWeight:   700,
          cursor:       from && to ? 'pointer' : 'default',
        }}
      >
        Aplicar
      </button>

      {(activeRange !== 'hoy' || isCustom) && (
        <button
          onClick={() => { setFrom(''); setTo(''); applyShortcut('hoy') }}
          style={{
            padding: '6px 10px', borderRadius: '8px',
            border: '1px solid #fecaca', background: '#fff5f5',
            color: '#dc2626', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
          }}
        >
          ✕
        </button>
      )}
    </div>
  )
}
