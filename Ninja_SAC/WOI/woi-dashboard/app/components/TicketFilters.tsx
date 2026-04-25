'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { GroupFilter, TICKET_STATUS_META, CATEGORY_ES } from '@/lib/queries'

type Props = {
  groups: GroupFilter[]
}

const STATUSES = ['abierto', 'respondido', 'pendiente', 'escalado', 'resuelto', 'no_resuelto_eod']
const URGENCIES = ['alta', 'media', 'baja']

export default function TicketFilters({ groups }: Props) {
  const router     = useRouter()
  const pathname   = usePathname()
  const params     = useSearchParams()

  function set(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    router.push(`${pathname}?${next.toString()}`)
  }

  function clear() {
    router.push(pathname)
  }

  const activeStatus   = params.get('status')   ?? ''
  const activeGroup    = params.get('group')     ?? ''
  const activeCategory = params.get('category')  ?? ''
  const activeUrgency  = params.get('urgency')   ?? ''

  const hasFilter = activeStatus || activeGroup || activeCategory || activeUrgency

  const selectStyle = (active: boolean): React.CSSProperties => ({
    padding:       '6px 12px',
    borderRadius:  '8px',
    border:        `1.5px solid ${active ? '#16a34a' : '#e2e8f0'}`,
    background:    active ? '#f0fdf4' : '#fff',
    color:         active ? '#15803d' : '#475569',
    fontSize:      '13px',
    fontWeight:    active ? 600 : 400,
    cursor:        'pointer',
    outline:       'none',
    appearance:    'none' as const,
    WebkitAppearance: 'none' as const,
    paddingRight:  '28px',
    backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath d=\'M2 4l4 4 4-4\' stroke=\'%2364748b\' stroke-width=\'1.5\' fill=\'none\' stroke-linecap=\'round\'/%3E%3C/svg%3E")',
    backgroundRepeat:   'no-repeat',
    backgroundPosition: 'right 10px center',
  })

  return (
    <div style={{
      display:        'flex',
      alignItems:     'center',
      gap:            '10px',
      flexWrap:       'wrap',
      padding:        '14px 20px',
      background:     '#fff',
      borderRadius:   '12px',
      border:         '1px solid #e2e8f0',
      marginBottom:   '20px',
    }}>
      <span style={{ fontSize: '13px', fontWeight: 700, color: '#475569', marginRight: '4px' }}>
        Filtros
      </span>

      {/* Grupo */}
      <select
        value={activeGroup}
        onChange={e => set('group', e.target.value || null)}
        style={selectStyle(!!activeGroup)}
      >
        <option value="">Todos los grupos</option>
        {groups.map(g => (
          <option key={g.id} value={String(g.id)}>{g.name}</option>
        ))}
      </select>

      {/* Tipo */}
      <select
        value={activeCategory}
        onChange={e => set('category', e.target.value || null)}
        style={selectStyle(!!activeCategory)}
      >
        <option value="">Todos los tipos</option>
        {Object.entries(CATEGORY_ES).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>

      {/* Estado */}
      <select
        value={activeStatus}
        onChange={e => set('status', e.target.value || null)}
        style={selectStyle(!!activeStatus)}
      >
        <option value="">Todos los estados</option>
        {STATUSES.map(s => (
          <option key={s} value={s}>{TICKET_STATUS_META[s]?.label ?? s}</option>
        ))}
      </select>

      {/* Urgencia */}
      <select
        value={activeUrgency}
        onChange={e => set('urgency', e.target.value || null)}
        style={selectStyle(!!activeUrgency)}
      >
        <option value="">Toda urgencia</option>
        {URGENCIES.map(u => (
          <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>
        ))}
      </select>

      {hasFilter && (
        <button
          onClick={clear}
          style={{
            padding:      '6px 12px',
            borderRadius: '8px',
            border:       '1px solid #fecaca',
            background:   '#fff5f5',
            color:        '#dc2626',
            fontSize:     '12px',
            fontWeight:   600,
            cursor:       'pointer',
          }}
        >
          Limpiar filtros ✕
        </button>
      )}
    </div>
  )
}
