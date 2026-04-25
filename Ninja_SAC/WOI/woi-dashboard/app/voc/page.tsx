import {
  getVocQuotes,
  getVocPatterns,
  getVocSummaryKpis,
  CATEGORY_ES,
  COUNTRY_FLAG,
} from '@/lib/queries'
import Link from 'next/link'
import { Suspense } from 'react'
import VocFilters from '@/app/components/VocFilters'

export const dynamic = 'force-dynamic'

// ── helpers ──────────────────────────────────────────────────────────────────

function resolveDates(period: string): { from: string; to: string } {
  const now = new Date()
  const to  = now.toISOString().split('T')[0]
  if (period === 'todos') return { from: '2024-01-01', to }
  const days = parseInt(period) || 30
  const from = new Date(now)
  from.setDate(from.getDate() - days)
  return { from: from.toISOString().split('T')[0], to }
}

function sentimentColor(s: number) {
  if (s <= -0.6) return { text: '#dc2626', bg: '#fef2f2', border: '#fecaca' }
  if (s <= -0.3) return { text: '#ea580c', bg: '#fff7ed', border: '#fed7aa' }
  if (s >=  0.6) return { text: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' }
  if (s >=  0.3) return { text: '#0891b2', bg: '#ecfeff', border: '#a5f3fc' }
  return { text: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' }
}

function SentimentBar({ value }: { value: number }) {
  const pct = Math.round(((value + 1) / 2) * 100)
  const color = value < -0.3 ? '#ef4444' : value > 0.3 ? '#10b981' : '#94a3b8'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 48, height: 4, background: '#e5e7eb', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99 }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 36 }}>
        {value > 0 ? '+' : ''}{value.toFixed(2)}
      </span>
    </div>
  )
}

function QuoteCard({ quote }: { quote: any }) {
  const colors = sentimentColor(quote.sentiment)
  const flag   = COUNTRY_FLAG[quote.country ?? ''] ?? ''
  const label  = CATEGORY_ES[quote.category ?? ''] ?? quote.category?.replace(/_/g, ' ') ?? ''

  return (
    <div style={{
      background: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: 12,
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      {/* Quote text */}
      <p style={{
        fontSize: 14, lineHeight: 1.6, color: '#0f172a',
        margin: 0, fontStyle: 'italic',
        borderLeft: `3px solid ${colors.border}`,
        paddingLeft: 12,
      }}>
        "{quote.content.length > 220 ? quote.content.slice(0, 220) + '…' : quote.content}"
      </p>

      {/* Meta row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Category */}
          {label && (
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
              background: quote.sentiment < -0.3 ? '#fee2e2' : '#dbeafe',
              color: quote.sentiment < -0.3 ? '#dc2626' : '#1d4ed8',
            }}>
              {label}
            </span>
          )}
          {/* Country + vertical */}
          {(quote.country || quote.vertical) && (
            <span style={{ fontSize: 11, color: '#64748b' }}>
              {flag} {quote.country}{quote.vertical ? ` · ${quote.vertical}` : ''}
            </span>
          )}
          {/* Group */}
          <Link href={`/grupos/${quote.group_id}`} style={{
            fontSize: 11, color: '#16a34a', textDecoration: 'none', fontWeight: 500,
          }}>
            {quote.client_name ?? quote.group_name}
          </Link>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <SentimentBar value={quote.sentiment} />
          <span style={{ fontSize: 11, color: '#94a3b8' }}>
            {new Date(quote.timestamp).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── page ─────────────────────────────────────────────────────────────────────

export default async function VocPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const sp       = await searchParams
  const period   = sp.period   ?? '30d'
  const polarity = (sp.polarity ?? 'both') as 'negative' | 'positive' | 'both'
  const country  = sp.country  || null
  const vertical = sp.vertical || null
  const groupId  = sp.group ? parseInt(sp.group) : null

  const { from, to } = resolveDates(period)

  const [quotes, patterns, summary] = await Promise.all([
    getVocQuotes({ from, to, polarity, country, vertical, groupId, limit: 60 }),
    getVocPatterns(from, to),
    getVocSummaryKpis(from, to),
  ])

  // Fetch filter options
  const { supabaseAdmin } = await import('@/lib/supabase')
  const { data: groupsRaw } = await supabaseAdmin
    .from('groups').select('id, name, country, vertical').eq('is_active', true).order('name')
  const groups   = (groupsRaw ?? []) as any[]
  const countries = [...new Set(groups.map(g => g.country).filter(Boolean))].sort() as string[]
  const verticals = [...new Set(groups.map(g => g.vertical).filter(Boolean))].sort() as string[]
  const groupList = groups.map(g => ({ id: g.id, name: g.name }))

  const negQuotes = quotes.filter(q => q.sentiment < -0.1).slice(0, 20)
  const posQuotes = quotes.filter(q => q.sentiment >  0.1).slice(0, 20)

  const periodLabel: Record<string, string> = {
    '7d': '7 días', '30d': '30 días', '90d': '90 días', todos: 'todo el tiempo',
  }

  // ── Top patterns: group by category ──────────────────────────────────────
  const byCategory = new Map<string, { count: number; avg: number; countries: Set<string>; verticals: Set<string>; sample: string | null }>()
  for (const p of patterns) {
    const key = p.category ?? 'otro'
    if (!byCategory.has(key)) byCategory.set(key, { count: 0, avg: 0, countries: new Set(), verticals: new Set(), sample: null })
    const e = byCategory.get(key)!
    e.count += p.neg_count
    e.avg   += p.avg_sentiment * p.neg_count
    if (p.country)  e.countries.add(p.country)
    if (p.vertical) e.verticals.add(p.vertical)
    if (!e.sample && p.sample_quote) e.sample = p.sample_quote
  }
  const topCategories = [...byCategory.entries()]
    .map(([cat, v]) => ({ cat, count: v.count, avg: v.count > 0 ? v.avg / v.count : 0, countries: [...v.countries], verticals: [...v.verticals], sample: v.sample }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
  const maxCount = topCategories[0]?.count ?? 1

  return (
    <div style={{ paddingBottom: 80 }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 }}>
            Voice of Customer
          </h1>
          <p style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>
            Lo que dicen los clientes — {periodLabel[period] ?? period}
            {country ? ` · ${COUNTRY_FLAG[country] ?? ''} ${country}` : ''}
            {vertical ? ` · ${vertical}` : ''}
          </p>
        </div>
        <Suspense fallback={null}>
          <VocFilters countries={countries} verticals={verticals} groups={groupList} />
        </Suspense>
      </div>

      {/* ── KPI summary ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 32 }}>
        {[
          {
            label: 'Voz negativa más frecuente',
            value: summary.topCategory ? (CATEGORY_ES[summary.topCategory[0]] ?? summary.topCategory[0]?.replace(/_/g, ' ')) : '—',
            sub: summary.topCategory ? `${summary.topCategory[1]} menciones negativas` : 'Sin datos',
            color: '#dc2626', bg: '#fef2f2',
          },
          {
            label: 'País con más quejas',
            value: summary.topCountry ? `${COUNTRY_FLAG[summary.topCountry[0]] ?? ''} ${summary.topCountry[0]}` : '—',
            sub: summary.topCountry ? `${summary.topCountry[1]} mensajes negativos` : 'Sin datos',
            color: '#ea580c', bg: '#fff7ed',
          },
          {
            label: 'Operación más afectada',
            value: summary.topVertical?.[0] ?? '—',
            sub: summary.topVertical ? `${summary.topVertical[1]} mensajes negativos` : 'Sin datos',
            color: '#7c3aed', bg: '#f5f3ff',
          },
        ].map(c => (
          <div key={c.label} style={{ background: c.bg, border: '1px solid #e5e7eb', borderRadius: 12, padding: '16px 20px' }}>
            <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c.color, lineHeight: 1.2 }}>{c.value}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Pattern heatmap: problem type breakdown ── */}
      {topCategories.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', marginBottom: 32 }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid #f1f5f9' }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#0f172a' }}>Problemas recurrentes</h2>
            <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
              Categorías con más voz negativa de clientes — ordenados por volumen
            </p>
          </div>
          <div style={{ padding: '8px 0' }}>
            {topCategories.map((item, i) => {
              const label = CATEGORY_ES[item.cat] ?? item.cat.replace(/_/g, ' ')
              const barWidth = Math.round((item.count / maxCount) * 100)
              const sentColor = item.avg < -0.6 ? '#dc2626' : item.avg < -0.3 ? '#ea580c' : '#6b7280'
              return (
                <div key={item.cat} style={{
                  padding: '12px 24px',
                  borderBottom: i < topCategories.length - 1 ? '1px solid #f8fafc' : 'none',
                  background: i % 2 === 0 ? '#fff' : '#fafafa',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                    {/* Category name + count */}
                    <div style={{ minWidth: 200 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{label}</span>
                      <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                        {item.countries.map(c => (
                          <span key={c} style={{ fontSize: 10, color: '#64748b' }}>{COUNTRY_FLAG[c] ?? ''} {c}</span>
                        ))}
                        {item.verticals.map(v => (
                          <span key={v} style={{ fontSize: 10, color: '#7c3aed', background: '#f5f3ff', padding: '1px 5px', borderRadius: 4 }}>{v}</span>
                        ))}
                      </div>
                    </div>

                    {/* Bar */}
                    <div style={{ flex: 1, height: 8, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ width: `${barWidth}%`, height: '100%', background: sentColor, borderRadius: 99 }} />
                    </div>

                    {/* Count + avg sentiment */}
                    <div style={{ textAlign: 'right', minWidth: 80 }}>
                      <span style={{ fontSize: 16, fontWeight: 800, color: sentColor }}>{item.count}</span>
                      <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 4 }}>menciones</span>
                      <div style={{ fontSize: 10, color: sentColor }}>avg {item.avg.toFixed(2)}</div>
                    </div>
                  </div>

                  {/* Sample quote */}
                  {item.sample && (
                    <div style={{
                      fontSize: 12, color: '#374151', fontStyle: 'italic',
                      background: '#f8fafc', borderRadius: 6, padding: '6px 10px',
                      borderLeft: `3px solid ${sentColor}`,
                    }}>
                      "{item.sample.length > 160 ? item.sample.slice(0, 160) + '…' : item.sample}"
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Two-column quotes section ── */}
      <div style={{ display: 'grid', gridTemplateColumns: polarity === 'both' ? '1fr 1fr' : '1fr', gap: 24 }}>
        {/* Negative voices */}
        {(polarity === 'both' || polarity === 'negative') && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 16 }}>🔴</span>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                Voz negativa
              </h2>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>({negQuotes.length})</span>
            </div>
            {negQuotes.length === 0 ? (
              <div style={{ background: '#f9fafb', borderRadius: 12, padding: '32px', textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
                Sin mensajes negativos en este período
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {negQuotes.map(q => <QuoteCard key={q.id} quote={q} />)}
              </div>
            )}
          </div>
        )}

        {/* Positive voices */}
        {(polarity === 'both' || polarity === 'positive') && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 16 }}>🟢</span>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                Voz positiva
              </h2>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>({posQuotes.length})</span>
            </div>
            {posQuotes.length === 0 ? (
              <div style={{ background: '#f9fafb', borderRadius: 12, padding: '32px', textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
                Sin mensajes positivos en este período
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {posQuotes.map(q => <QuoteCard key={q.id} quote={q} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
