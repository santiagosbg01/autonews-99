'use client'

import { useState } from 'react'
import type { TtfrByCategoryRow } from '@/lib/queries'

const SLA_TARGET_MIN = 30 // matches HEALTH_SLA_TTFR_MIN

type SortKey = 'count' | 'avg_ttfr_min' | 'resolution_rate' | 'escalated'

const SORT_LABEL: Record<SortKey, string> = {
  count: 'volumen',
  avg_ttfr_min: 'TTFR avg',
  resolution_rate: 'resolución',
  escalated: 'escaladas',
}

function fmtMin(m: number | null): string {
  if (m == null) return '—'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? `${h}h` : `${h}h ${r}m`
}

function ttfrColor(m: number | null): string {
  if (m == null) return '#94a3b8'
  if (m <= 15) return '#10b981'
  if (m <= SLA_TARGET_MIN) return '#0369a1'
  if (m <= 60) return '#f59e0b'
  return '#ef4444'
}

function bgFor(m: number | null): string {
  if (m == null) return '#f8fafc'
  if (m <= 15) return '#ecfdf5'
  if (m <= SLA_TARGET_MIN) return '#f0f9ff'
  if (m <= 60) return '#fffbeb'
  return '#fef2f2'
}

export default function TtfrByCategoryCard({ rows, periodLabel }: { rows: TtfrByCategoryRow[]; periodLabel: string }) {
  const [sortKey, setSortKey] = useState<SortKey>('count')
  const [desc, setDesc] = useState(true)

  function setSort(k: SortKey) {
    if (k === sortKey) {
      setDesc((d) => !d)
    } else {
      setSortKey(k)
      setDesc(k !== 'resolution_rate')  // higher is worse for ttfr/escalated, but better for resolution
    }
  }

  if (rows.length === 0) {
    return (
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20, marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#0f172a' }}>
          Tiempo de respuesta por tipo de incidencia
        </h3>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '12px 0 0' }}>
          Sin incidencias categorizadas en el período.
        </p>
      </div>
    )
  }

  const sorted = [...rows].sort((a, b) => {
    const av = (a[sortKey] ?? 0) as number
    const bv = (b[sortKey] ?? 0) as number
    return desc ? bv - av : av - bv
  })
  const totalCount = rows.reduce((s, r) => s + r.count, 0)
  const overallAvg = (() => {
    let num = 0; let den = 0
    for (const r of rows) {
      if (r.avg_ttfr_min == null) continue
      num += r.avg_ttfr_min * r.count
      den += r.count
    }
    return den > 0 ? Math.round(num / den) : null
  })()
  const slaBreaches = rows.filter((r) => (r.avg_ttfr_min ?? 0) > SLA_TARGET_MIN).length

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 14,
        marginBottom: 24,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ padding: '16px 22px', borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>
              Tiempo de respuesta · por tipo de incidencia
            </div>
            <h3 style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
              {totalCount.toLocaleString('es-MX')} incidencias en {rows.length} categoría{rows.length === 1 ? '' : 's'} · {periodLabel}
            </h3>
          </div>
          <div style={{ fontSize: 12, color: '#475569', textAlign: 'right' }}>
            <div>
              TTFR promedio:&nbsp;
              <strong style={{ color: ttfrColor(overallAvg) }}>{fmtMin(overallAvg)}</strong>
              <span style={{ color: '#94a3b8' }}> · SLA {SLA_TARGET_MIN}m</span>
            </div>
            <div style={{ fontSize: 11, color: slaBreaches > 0 ? '#dc2626' : '#16a34a' }}>
              {slaBreaches > 0
                ? `${slaBreaches} categoría${slaBreaches === 1 ? '' : 's'} fuera de SLA`
                : 'Todas las categorías dentro del SLA'}
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              <th style={thStyle}>Categoría</th>
              <SortableTh label="Volumen"    active={sortKey === 'count'}           desc={desc} onClick={() => setSort('count')} />
              <SortableTh label="TTFR avg"   active={sortKey === 'avg_ttfr_min'}    desc={desc} onClick={() => setSort('avg_ttfr_min')} />
              <th style={thStyle}>TTR avg</th>
              <SortableTh label="Resolución" active={sortKey === 'resolution_rate'} desc={desc} onClick={() => setSort('resolution_rate')} />
              <SortableTh label="Escaladas"  active={sortKey === 'escalated'}       desc={desc} onClick={() => setSort('escalated')} />
              <th style={thStyle}>Urgencia</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const tColor = ttfrColor(r.avg_ttfr_min)
              return (
                <tr key={r.category} style={{ borderTop: i > 0 ? '1px solid #f1f5f9' : 'none' }}>
                  <td style={{ ...tdStyle, fontWeight: 600, color: '#0f172a' }}>
                    <div>{r.label}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>
                      {r.pct}% · {r.open} abierta{r.open === 1 ? '' : 's'}
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 700 }}>{r.count}</div>
                  </td>
                  <td style={{ ...tdStyle, color: tColor, fontWeight: 700, background: bgFor(r.avg_ttfr_min) }}>
                    {fmtMin(r.avg_ttfr_min)}
                  </td>
                  <td style={tdStyle}>
                    <span style={{ color: '#475569' }}>{fmtMin(r.avg_ttr_min)}</span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      fontWeight: 700,
                      color: r.resolution_rate >= 80 ? '#10b981'
                        : r.resolution_rate >= 50 ? '#f59e0b' : '#ef4444',
                    }}>
                      {r.resolution_rate}%
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {r.escalated > 0
                      ? <span style={{ color: '#dc2626', fontWeight: 700 }}>{r.escalated}</span>
                      : <span style={{ color: '#cbd5e1' }}>0</span>}
                  </td>
                  <td style={tdStyle}>
                    <UrgencyBars alta={r.urgency_alta} media={r.urgency_media} baja={r.urgency_baja} total={r.count} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Footer legend */}
      <div style={{ padding: '10px 22px', background: '#f8fafc', borderTop: '1px solid #f1f5f9', fontSize: 11, color: '#64748b', display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        <span>Sort: <strong style={{ color: '#0f172a' }}>{SORT_LABEL[sortKey]}</strong> {desc ? '↓' : '↑'}</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 99, background: '#10b981', marginRight: 4 }} />≤ 15m</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 99, background: '#0369a1', marginRight: 4 }} />≤ {SLA_TARGET_MIN}m (SLA)</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 99, background: '#f59e0b', marginRight: 4 }} />≤ 60m</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 99, background: '#ef4444', marginRight: 4 }} />&gt; 60m</span>
      </div>
    </div>
  )
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

function UrgencyBars({ alta, media, baja, total }: { alta: number; media: number; baja: number; total: number }) {
  if (total === 0) return <span style={{ color: '#cbd5e1' }}>—</span>
  const pa = (alta  / total) * 100
  const pm = (media / total) * 100
  const pb = (baja  / total) * 100
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ display: 'flex', width: 90, height: 6, borderRadius: 99, overflow: 'hidden', background: '#f1f5f9' }}>
        {pa > 0 && <div style={{ width: `${pa}%`, background: '#ef4444' }} title={`Alta: ${alta}`} />}
        {pm > 0 && <div style={{ width: `${pm}%`, background: '#f59e0b' }} title={`Media: ${media}`} />}
        {pb > 0 && <div style={{ width: `${pb}%`, background: '#10b981' }} title={`Baja: ${baja}`} />}
      </div>
      <span style={{ fontSize: 11, color: '#94a3b8' }}>
        {alta}<span style={{ color: '#cbd5e1' }}>/</span>{media}<span style={{ color: '#cbd5e1' }}>/</span>{baja}
      </span>
    </div>
  )
}
