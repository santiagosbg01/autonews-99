'use client'

import { useState, useTransition } from 'react'
import { saveOperationalContextAction } from '@/app/grupos/[id]/actions'

const PLACEHOLDER = `Operación: [última milla B2C / cross-border / contract logistics / distribución MKP / etc.]
Cliente final: [nombre de la marca]
Volumen típico: [~N envíos/día]

Vocabulario propio:
  - "manifiesto" = corte diario de envíos (llega 4-5am)
  - "POD" = foto + firma del destinatario
  - "ruta XX" = identificador de viaje del día

Procesos rutinarios (NO son problemas):
  - Reporte de cierre diario a las 22h
  - Confirmación de salida con foto

SLA acordado:
  - Primera respuesta < 30 min en horario laboral
  - Resolución < 24h

Contactos clave:
  - KAM 99: [nombre, teléfono]
  - Decision maker cliente: [nombre, rol]

Issues activos esta semana:
  - [se borra cuando se resuelve]`

const MAX_CHARS = 4000

export default function OperationalContextCard({
  groupId,
  groupName,
  initialContext,
}: {
  groupId: number
  groupName: string
  initialContext: string | null
}) {
  const [text, setText] = useState(initialContext ?? '')
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [collapsed, setCollapsed] = useState(!!initialContext && (initialContext.length > 0))

  const isDirty = (initialContext ?? '') !== text
  const isOverLimit = text.length > MAX_CHARS
  const remaining = MAX_CHARS - text.length

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!isDirty || isOverLimit || pending) return
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await saveOperationalContextAction(formData)
      setMsg(
        res.ok
          ? { kind: 'ok', text: 'Guardado. Sonnet usará este contexto en próximas clasificaciones.' }
          : { kind: 'err', text: res.error ?? 'No se pudo guardar.' },
      )
      if (res.ok) setCollapsed(false)
    })
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Contexto operacional</h3>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {initialContext ? '✓ configurado' : 'sin configurar'}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        Sonnet usa este texto al clasificar mensajes, generar resúmenes y briefings de <strong>{groupName}</strong>.
        Describe vocabulario propio, SLAs, procesos rutinarios e issues activos.
      </div>

      {/* Toggle preview/edit cuando ya hay contenido */}
      {initialContext && collapsed && (
        <div>
          <pre
            style={{
              fontSize: 12,
              fontFamily: 'inherit',
              whiteSpace: 'pre-wrap',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 12,
              maxHeight: 220,
              overflowY: 'auto',
              margin: 0,
              color: 'var(--text)',
            }}
          >
            {initialContext}
          </pre>
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            style={btnSecondary}
          >
            Editar
          </button>
        </div>
      )}

      {(!initialContext || !collapsed) && (
        <form onSubmit={onSubmit}>
          <input type="hidden" name="groupId" value={groupId} />
          <textarea
            name="operational_context"
            value={text}
            onChange={(e) => { setText(e.target.value); setMsg(null) }}
            placeholder={PLACEHOLDER}
            rows={14}
            style={{
              width: '100%',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12,
              padding: '10px 12px',
              border: `1px solid ${isOverLimit ? 'var(--danger)' : 'var(--border)'}`,
              borderRadius: 6,
              background: 'var(--surface)',
              color: 'var(--text)',
              resize: 'vertical',
              lineHeight: 1.5,
            }}
          />
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 6,
            fontSize: 11,
            color: isOverLimit ? 'var(--danger)' : 'var(--text-muted)',
          }}>
            <span>
              {isOverLimit
                ? `${Math.abs(remaining)} chars de más — máximo ${MAX_CHARS}`
                : `${text.length} / ${MAX_CHARS} chars`}
            </span>
            <span>Soporta saltos de línea. No se requiere markdown formal.</span>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <button
              type="submit"
              disabled={!isDirty || isOverLimit || pending}
              style={{
                ...btnPrimary,
                cursor: !isDirty || isOverLimit || pending ? 'not-allowed' : 'pointer',
                opacity: !isDirty || isOverLimit || pending ? 0.5 : 1,
              }}
            >
              {pending ? 'Guardando…' : 'Guardar contexto'}
            </button>
            {initialContext && (
              <button
                type="button"
                onClick={() => { setText(initialContext); setCollapsed(true); setMsg(null) }}
                style={btnSecondary}
              >
                Cancelar
              </button>
            )}
            {msg && (
              <span style={{
                fontSize: 11,
                color: msg.kind === 'ok' ? 'var(--success)' : 'var(--danger)',
                marginLeft: 'auto',
              }}>
                {msg.text}
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  )
}

const btnPrimary: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  padding: '8px 14px',
  borderRadius: 6,
  border: 'none',
  background: 'var(--brand-blue)',
  color: '#fff',
}

const btnSecondary: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  padding: '8px 14px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  cursor: 'pointer',
}
