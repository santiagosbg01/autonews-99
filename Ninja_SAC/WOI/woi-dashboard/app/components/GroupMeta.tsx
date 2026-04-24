'use client'

import { useState, useRef, useEffect } from 'react'

const VERTICALS = ['Envios99', 'Tailor99', 'Freight99', 'Fulfill99', 'Punto99', 'Cross99', 'OTHER']

const COUNTRIES = [
  { code: 'MX', label: 'México',   flag: '🇲🇽' },
  { code: 'CL', label: 'Chile',    flag: '🇨🇱' },
  { code: 'CO', label: 'Colombia', flag: '🇨🇴' },
  { code: 'PE', label: 'Perú',     flag: '🇵🇪' },
]

const VERTICAL_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  Envios99:  { bg: '#4d65ff15', color: '#4d65ff', border: '#4d65ff40' },
  Tailor99:  { bg: '#8b5cf615', color: '#8b5cf6', border: '#8b5cf640' },
  Freight99: { bg: '#d9770618', color: '#d97706', border: '#d9770640' },
  Fulfill99: { bg: '#5a9e2f18', color: '#5a9e2f', border: '#5a9e2f40' },
  Punto99:   { bg: '#dc262618', color: '#dc2626', border: '#dc262640' },
  Cross99:   { bg: '#0891b218', color: '#0891b2', border: '#0891b240' },
  OTHER:     { bg: '#6b747415', color: '#6b7474', border: '#6b747440' },
}

type Props = {
  groupId: number
  vertical: string | null
  clientName: string | null
  country: string | null
}

export default function GroupMeta({ groupId, vertical, clientName, country }: Props) {
  const [currentVertical, setCurrentVertical] = useState(vertical ?? 'OTHER')
  const [currentClient, setCurrentClient] = useState(clientName ?? '')
  const [currentCountry, setCurrentCountry] = useState(country ?? 'MX')

  // Draft state for the edit panel
  const [open, setOpen] = useState(false)
  const [openUp, setOpenUp] = useState(false)
  const [draftVertical, setDraftVertical] = useState(currentVertical)
  const [draftClient, setDraftClient] = useState(currentClient)
  const [draftCountry, setDraftCountry] = useState(currentCountry)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function handleOpen() {
    setDraftVertical(currentVertical)
    setDraftClient(currentClient)
    setDraftCountry(currentCountry)
    setSaved(false)
    // Detect if near bottom of viewport to open upward
    if (panelRef.current) {
      const rect = panelRef.current.getBoundingClientRect()
      setOpenUp(rect.bottom + 260 > window.innerHeight)
    }
    setOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    await fetch(`/api/groups/${groupId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vertical: draftVertical,
        client_name: draftClient.trim() || null,
        country: draftCountry,
      }),
    })
    setCurrentVertical(draftVertical)
    setCurrentClient(draftClient.trim())
    setCurrentCountry(draftCountry)
    setSaving(false)
    setSaved(true)
    setTimeout(() => { setOpen(false); setSaved(false) }, 800)
  }

  const colors = VERTICAL_COLORS[currentVertical] ?? VERTICAL_COLORS.OTHER
  const countryObj = COUNTRIES.find(c => c.code === currentCountry)

  return (
    <div style={{ position: 'relative' }} ref={panelRef}>
      {/* Display row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Vertical badge */}
        <span style={{
          background: colors.bg, color: colors.color, border: `1px solid ${colors.border}`,
          borderRadius: 999, fontSize: 11, fontWeight: 600, padding: '2px 9px',
          letterSpacing: '0.02em', whiteSpace: 'nowrap',
        }}>
          {currentVertical}
        </span>

        {/* Country flag */}
        <span style={{ fontSize: 14 }} title={countryObj?.label}>{countryObj?.flag}</span>

        {/* Client name */}
        {currentClient
          ? <span style={{ fontSize: 12, color: 'var(--text-sub)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentClient}</span>
          : <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin cliente</span>
        }

        {/* Edit button */}
        <button
          onClick={handleOpen}
          title="Editar"
          style={{
            background: 'transparent', border: '1px solid var(--border)', borderRadius: 6,
            color: 'var(--text-muted)', cursor: 'pointer', padding: '4px 6px',
            lineHeight: 0, transition: 'all 0.15s', display: 'inline-flex', alignItems: 'center',
          }}
          onMouseOver={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--brand-green)'; (e.currentTarget as HTMLElement).style.color = 'var(--brand-green)'; (e.currentTarget as HTMLElement).style.background = 'var(--brand-green-dim)' }}
          onMouseOut={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H3v-2L11.5 2.5z"/>
          </svg>
        </button>
      </div>

      {/* Edit panel */}
      {open && (
        <div style={{
          position: 'absolute',
          ...(openUp ? { bottom: 'calc(100% + 8px)' } : { top: 'calc(100% + 8px)' }),
          left: 0, zIndex: 100,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 16, width: 260,
          boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>
            Editar grupo
          </div>

          {/* Operación */}
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Operación</label>
          <select
            value={draftVertical}
            onChange={e => setDraftVertical(e.target.value)}
            style={{
              width: '100%', marginBottom: 10,
              background: 'var(--surface-2)', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: 8,
              fontSize: 13, padding: '6px 10px', fontFamily: 'Inter, sans-serif',
              outline: 'none', cursor: 'pointer',
            }}
          >
            {VERTICALS.map(v => <option key={v} value={v}>{v}</option>)}
          </select>

          {/* País */}
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>País</label>
          <select
            value={draftCountry}
            onChange={e => setDraftCountry(e.target.value)}
            style={{
              width: '100%', marginBottom: 10,
              background: 'var(--surface-2)', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: 8,
              fontSize: 13, padding: '6px 10px', fontFamily: 'Inter, sans-serif',
              outline: 'none', cursor: 'pointer',
            }}
          >
            {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.label}</option>)}
          </select>

          {/* Cliente */}
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Cliente</label>
          <input
            value={draftClient}
            onChange={e => setDraftClient(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setOpen(false) }}
            placeholder="Ej: Amazon Mexico"
            style={{
              width: '100%', marginBottom: 14,
              background: 'var(--surface-2)', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: 8,
              fontSize: 13, padding: '6px 10px', fontFamily: 'Inter, sans-serif',
              outline: 'none', boxSizing: 'border-box',
            }}
            onFocus={e => (e.target.style.borderColor = 'var(--brand-green)')}
            onBlur={e => (e.target.style.borderColor = 'var(--border)')}
          />

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleSave}
              disabled={saving || saved}
              style={{
                flex: 1, background: saved ? 'var(--success)' : 'var(--brand-green)',
                color: 'white', border: 'none', borderRadius: 8,
                fontSize: 13, fontWeight: 600, padding: '7px 0',
                cursor: saving || saved ? 'default' : 'pointer',
                fontFamily: 'Inter, sans-serif', transition: 'background 0.2s',
              }}
            >
              {saved ? '✓ Guardado' : saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--border)', borderRadius: 8,
                fontSize: 13, padding: '7px 14px',
                cursor: 'pointer', fontFamily: 'Inter, sans-serif',
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
