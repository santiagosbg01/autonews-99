'use client'

import { useState, useTransition, useEffect } from 'react'
import {
  CATEGORY_ES,
  FEEDBACK_FIELD_LABEL,
  type ClassificationFeedback,
  type FeedbackField,
} from '@/lib/queries'
import { submitIncidentFeedbackAction } from '@/app/feedback/actions'

type Props = {
  incidentId: number
  groupId: number | null
  current: {
    category:      string | null
    urgency:       string | null
    sentiment_avg: number | null
    summary:       string | null
  }
  history: ClassificationFeedback[]
}

const CATEGORY_OPTIONS = Object.entries(CATEGORY_ES).map(([k, v]) => ({ value: k, label: v }))
  .sort((a, b) => a.label.localeCompare(b.label, 'es'))

const URGENCY_OPTIONS = [
  { value: 'baja',  label: 'Baja' },
  { value: 'media', label: 'Media' },
  { value: 'alta',  label: 'Alta' },
]

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-MX', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Mexico_City',
  })
}

function prettyValue(field: FeedbackField, value: string | null): string {
  if (value == null || value === '') return '—'
  if (field === 'category') return CATEGORY_ES[value] ?? value.replace(/_/g, ' ')
  if (field === 'urgency')  return value.toUpperCase()
  return value
}

export default function ClassificationFeedbackCard({ incidentId, groupId, current, history }: Props) {
  const [open, setOpen] = useState(false)
  const [field, setField] = useState<FeedbackField>('category')
  const [newValue, setNewValue] = useState('')
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()
  const [flash, setFlash] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  // Sync the input default with the chosen field
  useEffect(() => {
    if (field === 'category')  setNewValue(current.category  ?? '')
    if (field === 'urgency')   setNewValue(current.urgency   ?? 'media')
    if (field === 'sentiment') setNewValue(current.sentiment_avg != null ? String(current.sentiment_avg) : '0')
    if (field === 'summary')   setNewValue(current.summary   ?? '')
    if (field === 'other')     setNewValue('')
  }, [field, current.category, current.urgency, current.sentiment_avg, current.summary])

  function getOldValue(): string {
    if (field === 'category')  return current.category  ?? ''
    if (field === 'urgency')   return current.urgency   ?? ''
    if (field === 'sentiment') return current.sentiment_avg != null ? String(current.sentiment_avg) : ''
    if (field === 'summary')   return current.summary   ?? ''
    return ''
  }

  function handleSubmit() {
    setFlash(null)
    const oldValue = getOldValue()
    if ((oldValue ?? '').trim() === (newValue ?? '').trim()) {
      setFlash({ type: 'err', msg: 'El nuevo valor es igual al actual.' })
      return
    }
    const fd = new FormData()
    fd.append('incidentId', String(incidentId))
    if (groupId != null) fd.append('groupId', String(groupId))
    fd.append('field', field)
    fd.append('oldValue', oldValue)
    fd.append('newValue', newValue)
    if (reason.trim()) fd.append('reason', reason.trim())

    startTransition(async () => {
      try {
        await submitIncidentFeedbackAction(fd)
        setFlash({ type: 'ok', msg: 'Corrección registrada y aplicada.' })
        setReason('')
      } catch (e: any) {
        setFlash({ type: 'err', msg: e?.message ?? 'No se pudo guardar la corrección.' })
      }
    })
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', padding: '14px 18px', cursor: 'pointer', background: 'transparent',
          border: 'none', borderBottom: open ? '1px solid var(--border)' : 'none',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left',
        }}
      >
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Corrección de clasificación
          </div>
          <div style={{ fontSize: 13, color: '#0f172a', marginTop: 2 }}>
            ¿La categoría / urgencia / sentimiento están bien?{' '}
            <span style={{ color: 'var(--brand-green)', fontWeight: 600 }}>
              {open ? 'Cerrar' : 'Editar'}
            </span>
          </div>
        </div>
        {history.length > 0 && (
          <span style={{
            fontSize: 11, fontWeight: 700, color: '#0369a1', background: '#eff6ff',
            border: '1px solid #bfdbfe', padding: '2px 9px', borderRadius: 99,
          }}>
            {history.length} corrección{history.length === 1 ? '' : 'es'}
          </span>
        )}
      </button>

      {open && (
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Field selector */}
          <div>
            <label style={lbl}>Campo a corregir</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['category', 'urgency', 'sentiment', 'summary', 'other'] as FeedbackField[]).map((f) => {
                const active = f === field
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setField(f)}
                    style={{
                      padding: '4px 11px', borderRadius: 99,
                      border: `1px solid ${active ? '#0f172a' : '#e2e8f0'}`,
                      background: active ? '#0f172a' : '#fff',
                      color: active ? '#fff' : '#475569',
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    {FEEDBACK_FIELD_LABEL[f]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Old vs new */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Valor actual (de Sonnet)</label>
              <div style={readOnlyBox}>
                {prettyValue(field, getOldValue() || null)}
              </div>
            </div>
            <div>
              <label style={lbl}>Valor correcto</label>
              {field === 'category' && (
                <select value={newValue} onChange={(e) => setNewValue(e.target.value)} style={inputStyle}>
                  <option value="">— elegir —</option>
                  {CATEGORY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              )}
              {field === 'urgency' && (
                <select value={newValue} onChange={(e) => setNewValue(e.target.value)} style={inputStyle}>
                  {URGENCY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              )}
              {field === 'sentiment' && (
                <input
                  type="number" step="0.05" min={-1} max={1}
                  value={newValue} onChange={(e) => setNewValue(e.target.value)}
                  placeholder="-1 a +1"
                  style={inputStyle}
                />
              )}
              {field === 'summary' && (
                <textarea
                  value={newValue} onChange={(e) => setNewValue(e.target.value)}
                  rows={3} style={{ ...inputStyle, resize: 'vertical', minHeight: 70 }}
                  placeholder="Resumen corregido"
                />
              )}
              {field === 'other' && (
                <input
                  type="text" value={newValue} onChange={(e) => setNewValue(e.target.value)}
                  placeholder="Describí el cambio"
                  style={inputStyle}
                />
              )}
            </div>
          </div>

          {/* Reason */}
          <div>
            <label style={lbl}>Motivo / contexto (opcional)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Ej: el cliente nunca dijo que el camión llegó tarde, fue tema de horario."
              style={{ ...inputStyle, resize: 'vertical', minHeight: 50 }}
            />
          </div>

          {/* Submit */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
            {flash && (
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: flash.type === 'ok' ? '#16a34a' : '#dc2626',
              }}>
                {flash.msg}
              </span>
            )}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={pending}
              style={{
                padding: '7px 16px',
                background: pending ? '#94a3b8' : 'var(--brand-green)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                cursor: pending ? 'wait' : 'pointer',
              }}
            >
              {pending ? 'Guardando…' : 'Aplicar corrección'}
            </button>
          </div>

          {/* History */}
          <div style={{ marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              Historial de correcciones
            </div>
            {history.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                Sin correcciones aún. Cualquiera que hagas se registra acá y alimenta el dataset de entrenamiento.
              </p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.map((h) => (
                  <li key={h.id} style={{
                    border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px',
                    background: '#f8fafc', fontSize: 12,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 6 }}>
                      <span style={{ fontWeight: 700, color: '#0f172a' }}>
                        {FEEDBACK_FIELD_LABEL[h.field]}
                      </span>
                      <span style={{ fontSize: 10, color: '#64748b' }}>
                        {fmtDateTime(h.submitted_at)} · {h.submitted_by}
                        {!h.applied && <span style={{ color: '#dc2626', marginLeft: 6 }}>(no aplicado)</span>}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', flexWrap: 'wrap' }}>
                      <span style={{ color: '#94a3b8' }}>{prettyValue(h.field, h.old_value)}</span>
                      <span style={{ color: '#cbd5e1' }}>→</span>
                      <span style={{ color: '#0f172a', fontWeight: 600 }}>
                        {prettyValue(h.field, h.new_value)}
                      </span>
                    </div>
                    {h.reason && (
                      <div style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic', marginTop: 4 }}>
                        "{h.reason}"
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const lbl: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  fontWeight: 700,
  color: '#64748b',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  marginBottom: 5,
}

const readOnlyBox: React.CSSProperties = {
  fontSize: 13,
  color: '#475569',
  background: '#f1f5f9',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: '7px 10px',
  minHeight: 36,
  lineHeight: 1.4,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  fontSize: 13,
  color: '#0f172a',
  background: '#fff',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  padding: '7px 10px',
  fontFamily: 'inherit',
  outline: 'none',
}
