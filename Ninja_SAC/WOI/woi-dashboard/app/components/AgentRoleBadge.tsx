'use client'

import { useState } from 'react'
import { AGENT_ROLE_META, type AgentRole } from '@/lib/queries'

export default function AgentRoleBadge({
  role,
  size = 'sm',
}: {
  role: AgentRole
  size?: 'xs' | 'sm' | 'md'
}) {
  const meta = AGENT_ROLE_META[role]
  const [open, setOpen] = useState(false)
  const padding = size === 'xs' ? '2px 7px' : size === 'sm' ? '3px 9px' : '5px 12px'
  const fs      = size === 'xs' ? 10 : size === 'sm' ? 11 : 12

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding,
          background: meta.bg,
          color: meta.color,
          border: `1px solid ${meta.border}`,
          borderRadius: 99,
          fontSize: fs,
          fontWeight: 700,
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
          cursor: 'help',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 99, background: meta.color, display: 'inline-block' }} />
        {meta.short}
      </span>
      {open && (
        <span
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 50,
            background: '#0f172a',
            color: '#fff',
            padding: '8px 10px',
            borderRadius: 8,
            fontSize: 11,
            lineHeight: 1.45,
            width: 240,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            fontWeight: 400,
            textTransform: 'none',
            letterSpacing: 0,
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{meta.label}</div>
          <div style={{ color: '#cbd5e1' }}>{meta.desc}</div>
        </span>
      )}
    </span>
  )
}
