'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  CHURN_SEVERITY_META,
  CHURN_SOURCE_LABEL,
  type ChurnSignal,
} from '@/lib/queries'
import { resolveChurnSignalAction } from '@/app/churn/actions'

type Variant = 'banner' | 'inline'

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  const diffMin = Math.round((Date.now() - t) / 60000)
  if (diffMin < 1) return 'hace instantes'
  if (diffMin < 60) return `hace ${diffMin} min`
  const h = Math.round(diffMin / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return `hace ${d} d`
}

function dominantSeverity(signals: ChurnSignal[]) {
  for (const sev of ['threat_to_leave', 'aggressive_language', 'service_complaint'] as const) {
    if (signals.some((s) => s.severity === sev)) return sev
  }
  return 'service_complaint' as const
}

export default function ChurnAlertBanner({
  signals,
  groupId,
  variant = 'banner',
  collapsedByDefault = false,
}: {
  signals: ChurnSignal[]
  groupId?: number
  variant?: Variant
  collapsedByDefault?: boolean
}) {
  const [expanded, setExpanded] = useState(!collapsedByDefault)
  const [pending, startTransition] = useTransition()
  const [resolvingId, setResolvingId] = useState<number | null>(null)

  if (!signals?.length) return null

  const top = dominantSeverity(signals)
  const meta = CHURN_SEVERITY_META[top]
  const counts = {
    threat_to_leave: signals.filter((s) => s.severity === 'threat_to_leave').length,
    aggressive_language: signals.filter((s) => s.severity === 'aggressive_language').length,
    service_complaint: signals.filter((s) => s.severity === 'service_complaint').length,
  }
  const summary = [
    counts.threat_to_leave && `${counts.threat_to_leave} amenaza${counts.threat_to_leave === 1 ? '' : 's'} de salida`,
    counts.aggressive_language && `${counts.aggressive_language} agresión${counts.aggressive_language === 1 ? '' : 'es'}`,
    counts.service_complaint && `${counts.service_complaint} queja${counts.service_complaint === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' · ')

  function handleResolve(id: number) {
    setResolvingId(id)
    const fd = new FormData()
    fd.set('id', String(id))
    if (groupId) fd.set('groupId', String(groupId))
    startTransition(async () => {
      try {
        await resolveChurnSignalAction(fd)
      } finally {
        setResolvingId(null)
      }
    })
  }

  const wrapStyle: React.CSSProperties = {
    background: meta.bg,
    border: `1px solid ${meta.border}`,
    borderLeft: `4px solid ${meta.color}`,
    borderRadius: variant === 'banner' ? 12 : 8,
    padding: variant === 'banner' ? '14px 18px' : '10px 12px',
    marginBottom: variant === 'banner' ? 18 : 12,
  }

  return (
    <div style={wrapStyle} role="alert" aria-live="polite">
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          cursor: 'pointer', userSelect: 'none',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 26, height: 26, borderRadius: '50%',
              background: meta.color, color: '#fff', fontSize: 14, fontWeight: 700,
              flexShrink: 0,
            }}
            aria-label="warning"
          >!</span>
          <span style={{ fontWeight: 700, color: meta.color, fontSize: variant === 'banner' ? 14 : 13 }}>
            Riesgo de churn detectado
          </span>
          <span style={{ fontSize: 12, color: '#475569' }}>
            {signals.length} señal{signals.length === 1 ? '' : 'es'} abiertas {summary && `· ${summary}`}
          </span>
        </div>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {expanded ? '▲ ocultar' : '▼ ver detalle'}
        </span>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {signals.map((s) => {
            const sevMeta = CHURN_SEVERITY_META[s.severity]
            const isResolving = pending && resolvingId === s.id
            return (
              <div
                key={s.id}
                style={{
                  background: '#fff',
                  border: `1px solid ${sevMeta.border}`,
                  borderRadius: 8,
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px',
                      borderRadius: 999, background: sevMeta.bg, color: sevMeta.color,
                      border: `1px solid ${sevMeta.border}`,
                    }}
                  >{sevMeta.label}</span>
                  {!groupId && s.group_name && (
                    <Link
                      href={`/grupos/${s.group_id}`}
                      style={{ fontSize: 12, color: '#0369a1', fontWeight: 600, textDecoration: 'none' }}
                    >{s.group_name}{s.group_country ? ` · ${s.group_country}` : ''}</Link>
                  )}
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    {formatRelative(s.detected_at)}
                    {s.sender_display_name ? ` · ${s.sender_display_name}` : ''}
                    {' · '}{CHURN_SOURCE_LABEL[s.source]}
                    {s.matched_keyword ? ` · "${s.matched_keyword}"` : ''}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: '#0f172a', fontStyle: 'italic', lineHeight: 1.4 }}>
                  &ldquo;{s.quote}&rdquo;
                </div>
                {s.context && (
                  <div style={{ fontSize: 11, color: '#475569' }}>{s.context}</div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  {s.incident_id && (
                    <Link
                      href={`/tickets/${s.incident_id}`}
                      style={{
                        fontSize: 11, padding: '4px 10px', borderRadius: 6,
                        background: '#f1f5f9', color: '#334155', textDecoration: 'none', fontWeight: 600,
                      }}
                    >Ver ticket #{s.incident_id}</Link>
                  )}
                  <button
                    type="button"
                    onClick={() => handleResolve(s.id)}
                    disabled={isResolving}
                    style={{
                      fontSize: 11, padding: '4px 10px', borderRadius: 6,
                      background: '#ecfdf5', color: '#065f46', border: '1px solid #86efac',
                      fontWeight: 600, cursor: isResolving ? 'wait' : 'pointer',
                      opacity: isResolving ? 0.6 : 1,
                    }}
                  >{isResolving ? 'Resolviendo…' : 'Marcar atendido'}</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
