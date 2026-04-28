'use client'

import { useState, useTransition } from 'react'
import { saveBusinessHoursAction } from '@/app/grupos/[id]/actions'
import { VALID_BUSINESS_DAYS } from '@/lib/queries'

const DAY_LABELS: Record<string, string> = {
  mon: 'Lun', tue: 'Mar', wed: 'Mié', thu: 'Jue', fri: 'Vie', sat: 'Sáb', sun: 'Dom',
}

const PRESETS: { label: string; start: number; end: number; days: readonly string[] }[] = [
  { label: '24/7',                start: 0, end: 24, days: VALID_BUSINESS_DAYS },
  { label: 'Lun-Vie 9-18',        start: 9, end: 18, days: ['mon','tue','wed','thu','fri'] },
  { label: 'Lun-Sáb 8-20',        start: 8, end: 20, days: ['mon','tue','wed','thu','fri','sat'] },
  { label: 'Todos los días 9-20', start: 9, end: 20, days: VALID_BUSINESS_DAYS },
]

export default function BusinessHoursCard({
  groupId,
  initialStart,
  initialEnd,
  initialDays,
  timezone,
}: {
  groupId: number
  initialStart: number
  initialEnd: number
  initialDays: string[]
  timezone: string
}) {
  const [hourStart, setHourStart] = useState(initialStart)
  const [hourEnd, setHourEnd] = useState(initialEnd)
  const [days, setDays] = useState<string[]>(initialDays)
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const isDirty =
    hourStart !== initialStart ||
    hourEnd !== initialEnd ||
    days.slice().sort().join(',') !== initialDays.slice().sort().join(',')

  const isValid =
    hourStart >= 0 && hourStart <= 23 &&
    hourEnd >= 1 && hourEnd <= 24 &&
    hourEnd > hourStart &&
    days.length >= 1

  function toggleDay(d: string) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
    setMsg(null)
  }

  function applyPreset(p: typeof PRESETS[number]) {
    setHourStart(p.start)
    setHourEnd(p.end)
    setDays([...p.days])
    setMsg(null)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!isValid || pending) return
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await saveBusinessHoursAction(formData)
      setMsg(
        res.ok
          ? { kind: 'ok', text: 'Guardado. TTFR/TTR usarán esta ventana en cálculos futuros.' }
          : { kind: 'err', text: res.error ?? 'No se pudo guardar.' },
      )
    })
  }

  const summary = describeWindow(hourStart, hourEnd, days)

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Horario laboral</h3>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{timezone}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        TTFR y TTR del grupo se miden solo dentro de esta ventana (hora local del grupo).
      </div>

      <form onSubmit={onSubmit}>
        <input type="hidden" name="groupId" value={groupId} />

        {/* Presets */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p)}
              style={{
                fontSize: 11,
                padding: '4px 10px',
                borderRadius: 99,
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Hora inicio / fin */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <label style={{ fontSize: 12 }}>
            <div style={{ marginBottom: 4, color: 'var(--text-muted)' }}>Hora inicio</div>
            <input
              name="hour_start"
              type="number"
              min={0}
              max={23}
              step={1}
              value={hourStart}
              onChange={(e) => { setHourStart(Number(e.target.value)); setMsg(null) }}
              style={inputStyle}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            <div style={{ marginBottom: 4, color: 'var(--text-muted)' }}>Hora fin (exclusive)</div>
            <input
              name="hour_end"
              type="number"
              min={1}
              max={24}
              step={1}
              value={hourEnd}
              onChange={(e) => { setHourEnd(Number(e.target.value)); setMsg(null) }}
              style={inputStyle}
            />
          </label>
        </div>

        {/* Días */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Días laborales</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {VALID_BUSINESS_DAYS.map((d) => {
              const active = days.includes(d)
              return (
                <label key={d} style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    name={`day_${d}`}
                    checked={active}
                    onChange={() => toggleDay(d)}
                    style={{ display: 'none' }}
                  />
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '6px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      border: `1px solid ${active ? 'var(--brand-blue)' : 'var(--border)'}`,
                      background: active ? 'var(--brand-blue)' : 'var(--surface-2)',
                      color: active ? '#fff' : 'var(--text)',
                      userSelect: 'none',
                    }}
                  >
                    {DAY_LABELS[d]}
                  </span>
                </label>
              )
            })}
          </div>
        </div>

        {/* Resumen */}
        <div
          style={{
            fontSize: 12,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 8,
            marginBottom: 12,
            color: 'var(--text-muted)',
          }}
        >
          {summary}
        </div>

        {/* Acciones */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="submit"
            disabled={!isDirty || !isValid || pending}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '8px 14px',
              borderRadius: 6,
              border: 'none',
              background: !isDirty || !isValid || pending ? 'var(--surface-2)' : 'var(--brand-blue)',
              color: !isDirty || !isValid || pending ? 'var(--text-muted)' : '#fff',
              cursor: !isDirty || !isValid || pending ? 'not-allowed' : 'pointer',
            }}
          >
            {pending ? 'Guardando…' : 'Guardar'}
          </button>
          {msg && (
            <span
              style={{
                fontSize: 11,
                color: msg.kind === 'ok' ? 'var(--success)' : 'var(--danger)',
              }}
            >
              {msg.text}
            </span>
          )}
        </div>
      </form>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--surface)',
  color: 'var(--text)',
}

function describeWindow(start: number, end: number, days: string[]): string {
  if (end <= start || days.length === 0) {
    return 'Configuración inválida.'
  }
  const hoursPerDay = end - start
  const isAllDays = VALID_BUSINESS_DAYS.every((d) => days.includes(d))
  const isWeekdaysOnly =
    days.length === 5 &&
    ['mon','tue','wed','thu','fri'].every((d) => days.includes(d))
  const dayDesc = isAllDays
    ? 'todos los días'
    : isWeekdaysOnly
      ? 'lun-vie'
      : days.map((d) => DAY_LABELS[d]).join(', ')
  const horario =
    start === 0 && end === 24 ? '24h' : `${pad(start)}:00 a ${pad(end)}:00`
  return `Ventana: ${horario} · ${dayDesc} · ${hoursPerDay}h × ${days.length} días = ${hoursPerDay * days.length} h/sem`
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}
