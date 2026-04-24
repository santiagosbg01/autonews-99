'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

type Group = { id: number; name: string }

type Props = {
  groups: Group[]
}

const PERIOD_OPTS = [
  { v: '7d',    label: '7 días'   },
  { v: '30d',   label: '30 días'  },
  { v: '90d',   label: '90 días'  },
  { v: 'todos', label: 'Todos'    },
]

function toFromTo(period: string): { from: string; to: string } {
  const now  = new Date()
  const to   = now.toISOString().split('T')[0]
  if (period === 'todos') return { from: '2024-01-01', to }
  const days = parseInt(period)
  const from = new Date(now)
  from.setDate(from.getDate() - days)
  return { from: from.toISOString().split('T')[0], to }
}

export default function AnalyticsFilters({ groups }: Props) {
  const router      = useRouter()
  const searchParams = useSearchParams()

  const period  = searchParams.get('period') ?? '30d'
  const groupId = searchParams.get('group') ?? ''

  const update = useCallback((key: string, val: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (val) params.set(key, val)
    else params.delete(key)
    router.push(`/analytics?${params.toString()}`)
  }, [router, searchParams])

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      {/* Period pills */}
      <div style={{ display: 'flex', gap: 6, background: '#f1f5f9', borderRadius: 10, padding: 4 }}>
        {PERIOD_OPTS.map(o => (
          <button
            key={o.v}
            onClick={() => update('period', o.v)}
            style={{
              padding: '5px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
              background: period === o.v ? '#16a34a' : 'transparent',
              color:      period === o.v ? '#fff'    : '#475569',
            }}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* Group selector */}
      <select
        value={groupId}
        onChange={e => update('group', e.target.value)}
        style={{
          padding: '6px 32px 6px 12px', borderRadius: 8, border: '1px solid #e2e8f0',
          fontSize: 13, color: '#374151', background: '#fff', cursor: 'pointer',
          appearance: 'none',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2394a3b8' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 10px center',
        }}
      >
        <option value="">Todos los grupos</option>
        {groups.map(g => (
          <option key={g.id} value={String(g.id)}>{g.name}</option>
        ))}
      </select>
    </div>
  )
}

export function resolvePeriodToRange(period: string): { from: string; to: string } {
  return toFromTo(period)
}
