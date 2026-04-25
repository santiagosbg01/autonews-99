import {
  getAgentAnalysis,
  summarizeAgentRoles,
  AGENT_ROLE_META,
  type AgentRole,
} from '@/lib/queries'
import Link from 'next/link'
import AgentLeaderboardCard from '@/app/components/AgentLeaderboardCard'

export const dynamic = 'force-dynamic'

const PERIOD_LABEL: Record<string, string> = {
  '7d':  'últimos 7 días',
  '14d': 'últimas 2 semanas',
  '30d': 'últimos 30 días',
  '90d': 'últimos 90 días',
}

function resolveDates(period: string): { from: string; to: string } {
  const now  = new Date()
  const to   = now.toISOString().split('T')[0]
  if (period === 'todos') return { from: '2024-01-01', to }
  const days = parseInt(period) || 30
  const from = new Date(now)
  from.setDate(from.getDate() - days)
  return { from: from.toISOString().split('T')[0], to }
}

export default async function AgentesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const sp     = await searchParams
  const period = sp.period ?? '30d'
  const { from, to } = resolveDates(period)
  const rows = await getAgentAnalysis(from, to, null)
  const counts = summarizeAgentRoles(rows)

  return (
    <div style={{ padding: '24px 40px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>
              Equipo de operación 99minutos
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: '4px 0 4px', color: '#0f172a' }}>
              Análisis de agentes
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
              Cómo está distribuido el trabajo entre frontline, supervisores y observadores — {PERIOD_LABEL[period] ?? period}.
            </p>
          </div>

          {/* Period filter */}
          <div style={{ display: 'flex', gap: 6 }}>
            {(['7d', '14d', '30d', '90d'] as const).map((p) => (
              <Link
                key={p}
                href={`/agentes?period=${p}`}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  textDecoration: 'none',
                  border: '1px solid',
                  borderColor: p === period ? '#0f172a' : '#e2e8f0',
                  background: p === period ? '#0f172a' : '#fff',
                  color: p === period ? '#fff' : '#475569',
                }}
              >
                {p === '7d' ? '7d' : p === '14d' ? '14d' : p === '30d' ? '30d' : '90d'}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Top: role breakdown cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {(['primary', 'supervisor', 'observer'] as AgentRole[]).map((r) => {
          const meta = AGENT_ROLE_META[r]
          const total = rows.length || 1
          const pct = Math.round((counts[r] / total) * 100)
          return (
            <div
              key={r}
              style={{
                padding: '16px 20px',
                borderRadius: 12,
                border: `1px solid ${meta.border}`,
                background: meta.bg,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 9, height: 9, borderRadius: 99, background: meta.color }} />
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: meta.color }}>
                  {meta.label}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 28, fontWeight: 800, color: meta.color }}>{counts[r]}</span>
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  agente{counts[r] === 1 ? '' : 's'} · {pct}%
                </span>
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: '#475569', lineHeight: 1.4 }}>
                {meta.desc}
              </div>
            </div>
          )
        })}
      </div>

      {/* Empty state */}
      {rows.length === 0 ? (
        <div style={{
          padding: '48px 32px',
          background: '#f8fafc',
          borderRadius: 14,
          border: '1px dashed #cbd5e1',
          textAlign: 'center',
          color: '#64748b',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#0f172a' }}>
            Sin actividad de agentes en el período seleccionado.
          </div>
          <div style={{ fontSize: 12 }}>
            Probá con un período más amplio (90 días) o esperá a que la operación arranque.
          </div>
        </div>
      ) : (
        <AgentLeaderboardCard rows={rows} periodLabel={PERIOD_LABEL[period] ?? period} />
      )}
    </div>
  )
}
