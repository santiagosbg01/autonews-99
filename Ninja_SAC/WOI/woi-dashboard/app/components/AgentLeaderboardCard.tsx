'use client'

import { useState } from 'react'
import { AGENT_ROLE_META, type AgentAnalysisRow, type AgentRole } from '@/lib/queries'
import AgentRoleBadge from './AgentRoleBadge'

const SLA_TARGET_MIN = 30

type SortKey = 'role' | 'incidents_attended' | 'avg_ttfr_min' | 'resolution_rate_pct' | 'total_msgs' | 'share_escalated'

const SORT_LABEL: Record<SortKey, string> = {
  role: 'rol',
  incidents_attended: 'incidencias 1ª resp',
  avg_ttfr_min: 'TTFR avg',
  resolution_rate_pct: 'resolución',
  total_msgs: 'mensajes',
  share_escalated: '% escalado',
}

const ROLE_RANK: Record<AgentRole, number> = { primary: 0, supervisor: 1, observer: 2 }

function fmtMin(m: number | null): string {
  if (m == null) return '—'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60); const r = m % 60
  return r === 0 ? `${h}h` : `${h}h ${r}m`
}

function ttfrColor(m: number | null): string {
  if (m == null) return '#94a3b8'
  if (m <= 15) return '#10b981'
  if (m <= SLA_TARGET_MIN) return '#0369a1'
  if (m <= 60) return '#f59e0b'
  return '#ef4444'
}

function fmtRel(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const diffMin = (Date.now() - d.getTime()) / 60_000
  if (diffMin < 1)   return 'ahora'
  if (diffMin < 60)  return `hace ${Math.round(diffMin)}m`
  if (diffMin < 24 * 60) return `hace ${Math.round(diffMin / 60)}h`
  return `hace ${Math.round(diffMin / 60 / 24)}d`
}

export default function AgentLeaderboardCard({
  rows,
  periodLabel,
  showRoleFilter = true,
}: {
  rows: AgentAnalysisRow[]
  periodLabel: string
  showRoleFilter?: boolean
}) {
  const [sortKey, setSortKey] = useState<SortKey>('role')
  const [desc, setDesc] = useState(false)
  const [roleFilter, setRoleFilter] = useState<AgentRole | 'all'>('all')

  function setSort(k: SortKey) {
    if (k === sortKey) {
      setDesc((d) => !d)
    } else {
      setSortKey(k)
      setDesc(k !== 'role' && k !== 'avg_ttfr_min')
    }
  }

  if (rows.length === 0) {
    return (
      <div style={cardWrap}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#0f172a' }}>
          Análisis de agentes
        </h3>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '12px 0 0' }}>
          Sin actividad de agentes en el período.
        </p>
      </div>
    )
  }

  const counts: Record<AgentRole | 'all', number> = {
    all: rows.length,
    primary: rows.filter((r) => r.role === 'primary').length,
    supervisor: rows.filter((r) => r.role === 'supervisor').length,
    observer: rows.filter((r) => r.role === 'observer').length,
  }

  const filtered = roleFilter === 'all' ? rows : rows.filter((r) => r.role === roleFilter)

  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === 'role') {
      const ra = ROLE_RANK[a.role]; const rb = ROLE_RANK[b.role]
      const cmp = desc ? rb - ra : ra - rb
      if (cmp !== 0) return cmp
      return b.incidents_attended - a.incidents_attended
    }
    const av = (a[sortKey] ?? 0) as number
    const bv = (b[sortKey] ?? 0) as number
    return desc ? bv - av : av - bv
  })

  const totalMsgs = filtered.reduce((s, r) => s + r.total_msgs, 0)

  return (
    <div style={cardWrap}>
      {/* Header */}
      <div style={{ padding: '16px 22px', borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>
              Agentes · análisis y rol
            </div>
            <h3 style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
              {rows.length} agente{rows.length === 1 ? '' : 's'} con actividad · {totalMsgs.toLocaleString('es-MX')} mensajes · {periodLabel}
            </h3>
          </div>
          <div style={{ fontSize: 12, color: '#475569', textAlign: 'right' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {(['primary', 'supervisor', 'observer'] as const).map((r) => {
                const meta = AGENT_ROLE_META[r]
                return (
                  <span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: meta.color, display: 'inline-block' }} />
                    <strong style={{ color: meta.color, fontWeight: 700 }}>{counts[r]}</strong>
                    <span style={{ color: '#64748b' }}>{meta.short.toLowerCase()}</span>
                  </span>
                )
              })}
            </div>
          </div>
        </div>

        {/* Role filter pills */}
        {showRoleFilter && (
          <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
            {(['all', 'primary', 'supervisor', 'observer'] as const).map((r) => {
              const isActive = roleFilter === r
              const meta = r === 'all' ? null : AGENT_ROLE_META[r]
              const label = r === 'all' ? 'Todos' : meta!.short
              return (
                <button
                  key={r}
                  onClick={() => setRoleFilter(r)}
                  style={{
                    padding: '4px 11px',
                    borderRadius: 99,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    border: `1px solid ${isActive ? (meta?.color ?? '#0f172a') : '#e2e8f0'}`,
                    background: isActive ? (meta?.bg ?? '#0f172a') : '#fff',
                    color: isActive ? (meta?.color ?? '#fff') : '#475569',
                    transition: 'all 0.15s',
                  }}
                >
                  {label}
                  <span style={{
                    marginLeft: 6, fontSize: 10, fontWeight: 600,
                    color: isActive ? (meta?.color ?? '#cbd5e1') : '#94a3b8',
                  }}>
                    {counts[r]}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              <th style={thStyle}>#</th>
              <th style={thStyle}>Agente</th>
              <SortableTh label="Rol"            active={sortKey === 'role'}                desc={desc} onClick={() => setSort('role')} />
              <SortableTh label="1ª resp."       active={sortKey === 'incidents_attended'}  desc={desc} onClick={() => setSort('incidents_attended')} />
              <SortableTh label="TTFR avg"       active={sortKey === 'avg_ttfr_min'}        desc={desc} onClick={() => setSort('avg_ttfr_min')} />
              <SortableTh label="Resolución"     active={sortKey === 'resolution_rate_pct'} desc={desc} onClick={() => setSort('resolution_rate_pct')} />
              <SortableTh label="Mensajes"       active={sortKey === 'total_msgs'}          desc={desc} onClick={() => setSort('total_msgs')} />
              <th style={thStyle}>Grupos</th>
              <th style={thStyle}>Incidencias</th>
              <SortableTh label="% escalado"     active={sortKey === 'share_escalated'}     desc={desc} onClick={() => setSort('share_escalated')} />
              <th style={thStyle}>% alta</th>
              <th style={thStyle}>Última actividad</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const meta = AGENT_ROLE_META[r.role]
              return (
                <tr key={r.agent_phone} style={{ borderTop: i > 0 ? '1px solid #f1f5f9' : 'none' }}>
                  <td style={{ ...tdStyle, color: '#94a3b8', fontWeight: 700 }}>#{i + 1}</td>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600, color: '#0f172a' }}>
                      {r.agent_name || `…${r.agent_phone.slice(-4)}`}
                    </div>
                    {r.group_names.length > 0 && (
                      <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500, marginTop: 1, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.group_names.join(' · ')}
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <AgentRoleBadge role={r.role} size="xs" />
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: '#0f172a' }}>
                    {r.incidents_attended > 0 ? r.incidents_attended : <span style={{ color: '#cbd5e1' }}>0</span>}
                  </td>
                  <td style={{ ...tdStyle, color: ttfrColor(r.avg_ttfr_min), fontWeight: 700 }}>
                    {fmtMin(r.avg_ttfr_min)}
                  </td>
                  <td style={tdStyle}>
                    {r.resolution_rate_pct != null ? (
                      <span style={{
                        fontWeight: 700,
                        color: r.resolution_rate_pct >= 80 ? '#10b981'
                          : r.resolution_rate_pct >= 50 ? '#f59e0b' : '#ef4444',
                      }}>
                        {r.resolution_rate_pct}%
                      </span>
                    ) : (
                      <span style={{ color: '#cbd5e1' }}>—</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 600, color: '#0f172a' }}>{r.total_msgs}</span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ color: '#475569' }}>{r.distinct_groups}</span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ color: '#475569' }}>{r.distinct_incidents}</span>
                  </td>
                  <td style={tdStyle}>
                    {r.share_escalated > 0 ? (
                      <span style={{
                        fontWeight: 700,
                        color: r.share_escalated >= 30 ? '#b45309' : '#475569',
                      }}>
                        {r.share_escalated}%
                      </span>
                    ) : (
                      <span style={{ color: '#cbd5e1' }}>0%</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {r.share_alta > 0 ? (
                      <span style={{
                        fontWeight: 700,
                        color: r.share_alta >= 50 ? '#dc2626' : '#475569',
                      }}>
                        {r.share_alta}%
                      </span>
                    ) : (
                      <span style={{ color: '#cbd5e1' }}>0%</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, color: '#64748b', fontSize: 12 }}>
                    {fmtRel(r.last_active_at)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Footer / explanation */}
      <div style={{ padding: '10px 22px', background: '#f8fafc', borderTop: '1px solid #f1f5f9', fontSize: 11, color: '#64748b' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 6 }}>
          <span>Sort: <strong style={{ color: '#0f172a' }}>{SORT_LABEL[sortKey]}</strong> {desc ? '↓' : '↑'}</span>
          <span style={{ marginLeft: 'auto' }}>
            <strong style={{ color: '#0f172a' }}>1ª resp.</strong> = veces que el agente fue el primer agente_99 en contestar el ticket.
          </span>
        </div>
        <details>
          <summary style={{ cursor: 'pointer', color: '#475569', fontWeight: 600 }}>
            ¿Cómo se clasifica el rol?
          </summary>
          <div style={{ marginTop: 8, lineHeight: 1.55 }}>
            <div><strong style={{ color: AGENT_ROLE_META.primary.color }}>Primary responder</strong>: ≥ 3 tickets como primer respondedor en el período.</div>
            <div><strong style={{ color: AGENT_ROLE_META.supervisor.color }}>Supervisor / Escalación</strong>: pocos primer-respondedor pero con &gt;5 mensajes y al menos 30% del tráfico en tickets escalados, o &gt;50% en alta urgencia.</div>
            <div><strong style={{ color: AGENT_ROLE_META.observer.color }}>Observador</strong>: el resto — presente pero sin participación significativa.</div>
          </div>
        </details>
      </div>
    </div>
  )
}

const cardWrap: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 14,
  marginBottom: 24,
  overflow: 'hidden',
}

const thStyle: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: 11,
  fontWeight: 600,
  color: '#64748b',
  textAlign: 'left',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '11px 14px',
  fontSize: 13,
  color: '#0f172a',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
}

function SortableTh({ label, active, desc, onClick }: { label: string; active: boolean; desc: boolean; onClick: () => void }) {
  return (
    <th
      onClick={onClick}
      style={{
        ...thStyle,
        cursor: 'pointer',
        userSelect: 'none',
        color: active ? '#0f172a' : '#64748b',
      }}
    >
      {label}{active ? (desc ? ' ↓' : ' ↑') : ''}
    </th>
  )
}
