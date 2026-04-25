'use client'

export default function Topbar() {
  return (
    <nav style={{
      borderBottom: '1px solid var(--border)',
      background: 'var(--surface)',
      position: 'sticky', top: 0, zIndex: 50,
    }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <img
              src="/ninja-ops-monitor.jpg"
              alt="Ninja Ops Monitor"
              width={32}
              height={32}
              style={{ borderRadius: 8, display: 'block', objectFit: 'cover' }}
            />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>
                Ninja Ops
              </div>
              <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--brand-green)', letterSpacing: '0.08em', textTransform: 'uppercase', lineHeight: 1 }}>
                Monitor
              </div>
            </div>
          </a>

          <div style={{ width: 1, height: 24, background: 'var(--border)', margin: '0 4px' }} />

          <div style={{ display: 'flex', gap: 2 }}>
            {[{ href: '/briefing', label: 'Briefing' }, { href: '/', label: 'Grupos' }, { href: '/tickets', label: 'Tickets' }, { href: '/agentes', label: 'Agentes' }, { href: '/churn', label: 'Churn' }, { href: '/analytics', label: 'Analytics' }, { href: '/voc', label: 'VoC' }].map(link => (
              <a key={link.href} href={link.href} style={{
                fontSize: 13, fontWeight: 500, color: 'var(--text-sub)',
                textDecoration: 'none', padding: '5px 10px', borderRadius: 6,
                transition: 'all 0.15s',
              }}
              onMouseOver={e => { (e.target as HTMLElement).style.color = 'var(--text)'; (e.target as HTMLElement).style.background = 'var(--surface-2)'; }}
              onMouseOut={e => { (e.target as HTMLElement).style.color = 'var(--text-sub)'; (e.target as HTMLElement).style.background = 'transparent'; }}>
                {link.label}
              </a>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            fontSize: 11, fontWeight: 500, color: 'var(--brand-green)',
            background: 'var(--brand-green-dim)', border: '1px solid #85C44030',
            padding: '3px 10px', borderRadius: 999, display: 'flex', alignItems: 'center', gap: 5
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-green)', display: 'inline-block', animation: 'pulse-dot 2s infinite' }} />
            Listener activo
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Piloto V1
          </div>
        </div>
      </div>
    </nav>
  )
}
