import {
  getBriefingForGroupOnDate,
  getLatestBriefingForGroup,
  getRecentBriefings,
  type MorningBriefing,
} from '@/lib/queries'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const SEVERITY_META: Record<string, { color: string; bg: string; border: string; icon: string; label: string }> = {
  critical: { color: '#dc2626', bg: '#fef2f2', border: '#fecaca', icon: '●',  label: 'Crítico' },
  warning:  { color: '#d97706', bg: '#fffbeb', border: '#fed7aa', icon: '●',  label: 'Atención' },
  info:     { color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', icon: '●',  label: 'Info' },
}

const TREND_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  primera_vez: { text: '1ª vez',     color: '#0369a1', bg: '#e0f2fe' },
  recurrente:  { text: 'Recurrente', color: '#b45309', bg: '#fef3c7' },
  frecuente:   { text: 'Frecuente',  color: '#b91c1c', bg: '#fee2e2' },
}

function formatDate(d: string, tz?: string | null): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }
  if (tz) opts.timeZone = tz
  return new Date(d + 'T12:00:00').toLocaleDateString('es-MX', opts)
}

function formatShortDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short',
  })
}

export default async function BriefingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>
  searchParams: Promise<Record<string, string>>
}) {
  const { groupId: groupIdRaw } = await params
  const groupId = parseInt(groupIdRaw, 10)
  if (!Number.isFinite(groupId)) notFound()

  const sp = await searchParams
  const briefing: MorningBriefing | null = sp.date
    ? await getBriefingForGroupOnDate(groupId, sp.date)
    : await getLatestBriefingForGroup(groupId)

  if (!briefing) {
    return (
      <div style={{ paddingBottom: 80 }}>
        <Link href="/briefing" style={{ fontSize: 12, color: '#0369a1', textDecoration: 'none' }}>
          ← Todos los briefings
        </Link>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: '12px 0 0' }}>Morning Briefing</h1>
        <p style={{ color: '#6b7280', fontSize: 14, marginTop: 8 }}>
          Aún no hay briefing para este grupo. Se genera automáticamente a las 06:00 hora local del grupo.
        </p>
      </div>
    )
  }

  const recent = await getRecentBriefings(60)
  const recentForGroup = recent.filter(r => r.group_id === groupId).slice(0, 7)

  const b = briefing.briefing
  const m = briefing
  const ttfrMin = m.avg_ttfr_seconds ? Math.round(m.avg_ttfr_seconds / 60) : null
  const sentiment010 = m.avg_sentiment != null
    ? Math.round(((Number(m.avg_sentiment) + 1) / 2) * 100) / 10
    : null
  const churnCount = b.churn_signals?.length ?? 0

  return (
    <div style={{ paddingBottom: 80 }}>
      <Link href="/briefing" style={{ fontSize: 12, color: '#0369a1', textDecoration: 'none' }}>
        ← Todos los briefings
      </Link>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18, marginTop: 8, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#16a34a', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Morning Briefing
            </div>
            {m.group_country && (
              <span style={{ fontSize: 10, color: '#475569', background: '#f1f5f9', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
                {m.group_country}
              </span>
            )}
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0f172a', margin: '4px 0 0', lineHeight: 1.2 }}>
            {m.group_name ?? 'Grupo'}
          </h1>
          <p style={{ color: '#475569', fontSize: 13, marginTop: 2 }}>
            {formatDate(m.briefing_date, m.timezone)}
          </p>
          <p style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>
            Generado {new Date(m.generated_at).toLocaleString('es-MX', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
            {m.timezone ? ` · TZ ${m.timezone}` : ''}
          </p>
        </div>

        {recentForGroup.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {recentForGroup.map(r => {
              const isActive = r.briefing_date === m.briefing_date
              return (
                <Link
                  key={r.briefing_date}
                  href={`/briefing/${groupId}?date=${r.briefing_date}`}
                  style={{
                    background: isActive ? '#16a34a' : '#fff',
                    color: isActive ? '#fff' : '#475569',
                    border: `1px solid ${isActive ? '#16a34a' : '#e2e8f0'}`,
                    padding: '6px 10px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 500,
                    textDecoration: 'none',
                  }}
                >
                  {formatShortDate(r.briefing_date)}
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* Headline */}
      {m.headline && (
        <div style={{
          background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfeff 100%)',
          border: '1px solid #bbf7d0',
          borderRadius: 14,
          padding: '20px 24px',
          marginBottom: 18,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#16a34a', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
            Resumen del día
          </div>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: 0, lineHeight: 1.5 }}>
            {m.headline}
          </p>
        </div>
      )}

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 22 }}>
        {[
          { label: 'Mensajes',   value: m.total_messages ?? 0,        sub: 'total del día' },
          { label: 'Incidencias',value: m.total_incidents ?? 0,       sub: `${m.incidents_resolved ?? 0} resueltas` },
          { label: 'Escaladas',  value: m.incidents_escalated ?? 0,   sub: 'urgencia alta', color: (m.incidents_escalated ?? 0) > 2 ? '#dc2626' : undefined },
          { label: 'TTFR avg',   value: ttfrMin != null ? `${ttfrMin}m` : '—', sub: 'tiempo 1ª respuesta', color: ttfrMin != null && ttfrMin > 30 ? '#dc2626' : ttfrMin != null && ttfrMin > 15 ? '#d97706' : '#16a34a' },
          { label: 'Sentiment',  value: sentiment010 != null ? `${sentiment010}/10` : '—', sub: 'promedio del día', color: sentiment010 != null && sentiment010 < 5 ? '#dc2626' : sentiment010 != null && sentiment010 < 7 ? '#d97706' : '#16a34a' },
        ].map(k => (
          <div key={k.label} style={{
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 18px',
          }}>
            <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 500, marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: k.color ?? '#0f172a', lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Churn signals */}
      {churnCount > 0 && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 14,
          padding: '18px 22px', marginBottom: 18,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, color: '#dc2626',
              background: '#fee2e2', padding: '3px 10px', borderRadius: 999, letterSpacing: '0.05em',
            }}>
              CHURN RISK
            </span>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#7f1d1d', margin: 0 }}>
              Señales de riesgo de cliente · {churnCount} {churnCount === 1 ? 'señal' : 'señales'}
            </h2>
          </div>
          <p style={{ fontSize: 11, color: '#991b1b', margin: '0 0 12px', fontStyle: 'italic' }}>
            Frases reales de clientes con tono agresivo, amenazas de cambio de proveedor o pérdida de paciencia. Atención inmediata recomendada.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {b.churn_signals.map((s, i) => (
              <div key={i} style={{
                background: '#fff', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 14px',
              }}>
                {s.group && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#7f1d1d', marginBottom: 4 }}>
                    {s.group}
                  </div>
                )}
                <p style={{ fontSize: 13, color: '#0f172a', margin: '0 0 6px', lineHeight: 1.5, fontStyle: 'italic' }}>
                  &ldquo;{s.quote}&rdquo;
                </p>
                <div style={{ fontSize: 11, color: '#64748b' }}>{s.context}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Highlights (full width — per-group view) */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '18px 22px', marginBottom: 18 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: '0 0 12px' }}>
          Highlights
        </h2>
        {b.highlights.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: 13 }}>Sin highlights destacados.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {b.highlights.map((h, i) => {
              const sev = SEVERITY_META[h.severity] ?? SEVERITY_META.info
              return (
                <div key={i} style={{
                  background: sev.bg, border: `1px solid ${sev.border}`, borderRadius: 10,
                  padding: '12px 14px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ color: sev.color, fontSize: 14, lineHeight: 1 }}>{sev.icon}</span>
                    <strong style={{ fontSize: 13, color: '#0f172a' }}>{h.title}</strong>
                  </div>
                  <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5, paddingLeft: 22 }}>
                    {h.detail}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Incidents summary table */}
      {b.incidents_summary.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, marginBottom: 18, overflow: 'hidden' }}>
          <div style={{ padding: '16px 22px', borderBottom: '1px solid #f1f5f9' }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>
              Incidencias por categoría
            </h2>
            <p style={{ fontSize: 11, color: '#64748b', margin: '4px 0 0' }}>
              Etiqueta de tendencia comparada con últimos 7 y 30 días
            </p>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ textAlign: 'left',  padding: '10px 22px', fontSize: 11, color: '#64748b', fontWeight: 600 }}>Categoría</th>
                <th style={{ textAlign: 'center',padding: '10px 12px', fontSize: 11, color: '#64748b', fontWeight: 600 }}>Cantidad</th>
                <th style={{ textAlign: 'center',padding: '10px 12px', fontSize: 11, color: '#64748b', fontWeight: 600 }}>Tendencia</th>
                <th style={{ textAlign: 'left',  padding: '10px 22px', fontSize: 11, color: '#64748b', fontWeight: 600 }}>Nota</th>
              </tr>
            </thead>
            <tbody>
              {b.incidents_summary.map((i, idx) => {
                const t = TREND_LABEL[i.trend] ?? { text: i.trend, color: '#475569', bg: '#f1f5f9' }
                return (
                  <tr key={idx} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 22px', fontSize: 12, color: '#475569' }}>{i.category.replace(/_/g, ' ')}</td>
                    <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 700, color: '#0f172a', textAlign: 'center' }}>{i.count}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <span style={{
                        background: t.bg, color: t.color, padding: '3px 10px', borderRadius: 999,
                        fontSize: 10, fontWeight: 700, letterSpacing: '0.02em',
                      }}>{t.text}</span>
                    </td>
                    <td style={{ padding: '10px 22px', fontSize: 12, color: '#64748b', maxWidth: 380 }}>{i.note}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Trend note */}
      {b.trend_note && (
        <div style={{
          background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 14,
          padding: '18px 22px', marginBottom: 18,
        }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>
            Tendencia semanal y mensual
          </h2>
          <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: 0 }}>
            {b.trend_note}
          </p>
        </div>
      )}

      {/* Agents in red zone */}
      {b.agents_red_zone.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '18px 22px' }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: '0 0 4px' }}>
            Agentes en zona roja
          </h2>
          <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 12px' }}>
            TTFR promedio &gt; 30 minutos en horario laboral
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {b.agents_red_zone.map((a, i) => (
              <div key={i} style={{
                background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10,
                padding: '8px 14px', fontSize: 12,
              }}>
                <strong style={{ color: '#7f1d1d' }}>{a.agent}</strong>
                <span style={{ color: '#991b1b', marginLeft: 8 }}>
                  {a.incidents} inc · {a.ttfr_avg_min}m
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
