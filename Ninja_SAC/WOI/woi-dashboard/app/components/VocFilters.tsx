'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

type Props = {
  countries: string[]
  verticals: string[]
  groups: { id: number; name: string }[]
}

const PERIOD_OPTS = [
  { v: '7d',    label: '7 días'  },
  { v: '30d',   label: '30 días' },
  { v: '90d',   label: '90 días' },
  { v: 'todos', label: 'Todos'   },
]

const POLARITY_OPTS = [
  { v: 'both',     label: '⬤ Todos'     },
  { v: 'negative', label: '🔴 Negativos' },
  { v: 'positive', label: '🟢 Positivos' },
]

const selectStyle: React.CSSProperties = {
  padding: '6px 32px 6px 12px', borderRadius: 8, border: '1px solid #e2e8f0',
  fontSize: 13, color: '#374151', background: '#fff', cursor: 'pointer',
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2394a3b8' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
}

export default function VocFilters({ countries, verticals, groups }: Props) {
  const router      = useRouter()
  const searchParams = useSearchParams()

  const period   = searchParams.get('period')   ?? '30d'
  const polarity = searchParams.get('polarity') ?? 'both'
  const country  = searchParams.get('country')  ?? ''
  const vertical = searchParams.get('vertical') ?? ''
  const groupId  = searchParams.get('group')    ?? ''

  const update = useCallback((key: string, val: string) => {
    const p = new URLSearchParams(searchParams.toString())
    if (val) p.set(key, val); else p.delete(key)
    router.push(`/voc?${p.toString()}`)
  }, [router, searchParams])

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      {/* Period pills */}
      <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', borderRadius: 10, padding: 3 }}>
        {PERIOD_OPTS.map(o => (
          <button key={o.v} onClick={() => update('period', o.v)} style={{
            padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 600,
            background: period === o.v ? '#16a34a' : 'transparent',
            color:      period === o.v ? '#fff'    : '#475569',
          }}>{o.label}</button>
        ))}
      </div>

      {/* Polarity pills */}
      <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', borderRadius: 10, padding: 3 }}>
        {POLARITY_OPTS.map(o => (
          <button key={o.v} onClick={() => update('polarity', o.v)} style={{
            padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 600,
            background: polarity === o.v ? '#0f172a' : 'transparent',
            color:      polarity === o.v ? '#fff'    : '#475569',
          }}>{o.label}</button>
        ))}
      </div>

      {/* Country */}
      {countries.length > 0 && (
        <select value={country} onChange={e => update('country', e.target.value)} style={selectStyle}>
          <option value="">Todos los países</option>
          {countries.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      )}

      {/* Vertical */}
      {verticals.length > 0 && (
        <select value={vertical} onChange={e => update('vertical', e.target.value)} style={selectStyle}>
          <option value="">Todas las operaciones</option>
          {verticals.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      )}

      {/* Group */}
      <select value={groupId} onChange={e => update('group', e.target.value)} style={selectStyle}>
        <option value="">Todos los grupos</option>
        {groups.map(g => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
      </select>

      {/* Clear */}
      {(country || vertical || groupId || polarity !== 'both' || period !== '30d') && (
        <button onClick={() => router.push('/voc')} style={{
          padding: '5px 12px', borderRadius: 8, border: '1px solid #e2e8f0',
          background: '#fff', fontSize: 12, color: '#94a3b8', cursor: 'pointer',
        }}>✕ Limpiar</button>
      )}
    </div>
  )
}
