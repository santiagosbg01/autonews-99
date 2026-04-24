import type { GroupAnalysis } from '@/lib/queries'

/**
 * Extracts a JSON string value for `key` from raw text, even if the JSON is truncated.
 * Returns null if not found.
 */
function extractStringField(text: string, key: string): string | null {
  // Match: "key": "value" — value may contain escaped chars, stops at unescaped "
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\[\\s\\S])*)"`)
  const m = text.match(re)
  if (!m) return null
  try {
    return JSON.parse(`"${m[1]}"`) // unescape \\n, \\", etc.
  } catch {
    return m[1]
  }
}

function extractArrayField(text: string, key: string): string[] {
  const re = new RegExp(`"${key}"\\s*:\\s*\\[(.*?)\\]`, 's')
  const m = text.match(re)
  if (!m) return []
  try {
    return JSON.parse(`[${m[1]}]`)
  } catch {
    return []
  }
}

/**
 * When Claude's JSON extraction fails (e.g. response truncated by max_tokens),
 * the full raw response including ```json fences gets stored as `narrative`.
 * This function recovers as many fields as possible — even from truncated JSON.
 */
function tryRecoverAnalysis(analysis: GroupAnalysis): GroupAnalysis {
  const { narrative } = analysis
  if (!narrative) return analysis
  const looksLikeRaw =
    narrative.includes('"narrative"') ||
    narrative.trimStart().startsWith('```') ||
    narrative.trimStart().startsWith('{')
  if (!looksLikeRaw) return analysis

  // Strip ```json fences
  let text = narrative.trim()
  if (text.startsWith('```')) {
    const firstBrace = text.indexOf('{')
    if (firstBrace !== -1) text = text.slice(firstBrace)
    const lastBrace = text.lastIndexOf('}')
    if (lastBrace !== -1) text = text.slice(0, lastBrace + 1)
  }

  // Try full JSON parse first (works when not truncated)
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed.narrative === 'string') {
      return {
        ...analysis,
        narrative: parsed.narrative,
        insights: {
          key_topics:             parsed.key_topics             ?? analysis.insights?.key_topics             ?? [],
          anomalies:              parsed.anomalies              ?? analysis.insights?.anomalies              ?? [],
          recommendations:        parsed.recommendations        ?? analysis.insights?.recommendations        ?? [],
          dynamics:               parsed.dynamics               ?? analysis.insights?.dynamics               ?? '',
          client_sentiment_label: parsed.client_sentiment_label ?? analysis.insights?.client_sentiment_label ?? 'neutro',
          risk_level:             parsed.risk_level             ?? analysis.insights?.risk_level             ?? 'bajo',
          risk_reason:            parsed.risk_reason            ?? analysis.insights?.risk_reason            ?? null,
        },
        participants_summary: (parsed.participants ?? []).map((p: Record<string, string>) => ({
          name: p.name, role: p.role, behavior: p.behavior,
        })).length > 0 ? (parsed.participants ?? []).map((p: Record<string, string>) => ({
          name: p.name, role: p.role, behavior: p.behavior,
        })) : analysis.participants_summary,
      }
    }
  } catch {
    // JSON truncated — extract fields individually via regex
  }

  // Regex fallback: extract what we can from truncated JSON
  const recoveredNarrative = extractStringField(text, 'narrative')
  if (!recoveredNarrative) return analysis  // can't recover anything useful

  return {
    ...analysis,
    narrative: recoveredNarrative,
    insights: {
      key_topics:             extractArrayField(text, 'key_topics'),
      anomalies:              extractArrayField(text, 'anomalies'),
      recommendations:        extractArrayField(text, 'recommendations'),
      dynamics:               extractStringField(text, 'dynamics')               ?? analysis.insights?.dynamics               ?? '',
      client_sentiment_label: extractStringField(text, 'client_sentiment_label') ?? analysis.insights?.client_sentiment_label ?? 'neutro',
      risk_level:             extractStringField(text, 'risk_level')             ?? analysis.insights?.risk_level             ?? 'bajo',
      risk_reason:            extractStringField(text, 'risk_reason')            ?? analysis.insights?.risk_reason            ?? null,
    },
    participants_summary: analysis.participants_summary ?? [],
  }
}

const RISK_COLOR: Record<string, string> = { alto: '#ef4444', medio: '#f59e0b', bajo: '#10b981' }
const RISK_BG: Record<string, string>    = { alto: '#fef2f2', medio: '#fffbeb', bajo: '#f0fdf4' }
const RISK_DOT: Record<string, string>   = { alto: '🔴', medio: '🟡', bajo: '🟢' }

const SENTIMENT_LABEL: Record<string, string> = {
  muy_positivo: 'Muy positivo', positivo: 'Positivo', neutro: 'Neutro',
  negativo: 'Negativo', muy_negativo: 'Muy negativo',
}
const SENTIMENT_EMOJI: Record<string, string> = {
  muy_positivo: '😄', positivo: '🙂', neutro: '😐', negativo: '😕', muy_negativo: '😟',
}
const ROLE_LABEL: Record<string, string> = {
  agente_99: 'Agente 99', cliente: 'Cliente', otro: 'Otro',
}
const ROLE_COLOR: Record<string, string> = {
  cliente: '#5a9e2f', agente_99: '#3b82f6', otro: '#9ca3af',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#9ca3af',
        textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8,
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

export default function GroupAnalysisCard({ analysis: rawAnalysis }: { analysis: GroupAnalysis }) {
  const analysis = tryRecoverAnalysis(rawAnalysis)
  const { insights, participants_summary, narrative } = analysis
  const risk      = insights?.risk_level ?? 'bajo'
  const sentLabel = insights?.client_sentiment_label ?? 'neutro'

  const windowStart = new Date(analysis.window_start).toLocaleString('es-MX', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
  const windowEnd = new Date(analysis.window_end).toLocaleString('es-MX', {
    hour: '2-digit', minute: '2-digit',
  })
  const analyzedAt = new Date(analysis.analyzed_at).toLocaleString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  return (
    <div style={{ padding: '20px 24px' }}>

      {/* Date + metadata header */}
      <div style={{
        background: '#f8fafc', borderRadius: 10, padding: '12px 16px',
        marginBottom: 20, borderLeft: `3px solid ${RISK_COLOR[risk]}`,
      }}>
        <div style={{ fontSize: 12, color: '#374151', fontWeight: 600, marginBottom: 4 }}>
          Análisis generado el {analyzedAt}
        </div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>
          Ventana analizada: {windowStart} → {windowEnd} · {analysis.message_count} mensajes
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 10, alignItems: 'center' }}>
          <span style={{
            padding: '3px 12px', borderRadius: 99, fontSize: 12, fontWeight: 700,
            color: RISK_COLOR[risk], background: RISK_BG[risk],
          }}>
            {RISK_DOT[risk]} Riesgo {risk}
          </span>
          <span style={{ fontSize: 13 }}>
            {SENTIMENT_EMOJI[sentLabel]} Sentiment cliente: <strong>{SENTIMENT_LABEL[sentLabel] ?? sentLabel}</strong>
          </span>
          {insights?.risk_reason && (
            <span style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>
              — {insights.risk_reason}
            </span>
          )}
        </div>
      </div>

      {/* Narrative */}
      <Section title="¿Qué está pasando?">
        <p style={{ fontSize: 14, color: '#1f2937', lineHeight: 1.75, margin: 0 }}>
          {narrative}
        </p>
      </Section>

      {/* Dynamics */}
      {insights?.dynamics && (
        <Section title="Dinámica del grupo">
          <p style={{ fontSize: 13, color: '#374151', lineHeight: 1.65, margin: 0 }}>
            {insights.dynamics}
          </p>
        </Section>
      )}

      {/* Anomalies — highlighted */}
      {(insights?.anomalies?.length ?? 0) > 0 && (
        <Section title="⚠ Anomalías detectadas">
          <div style={{ background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: 8, padding: '12px 16px' }}>
            {insights!.anomalies.map((a, i) => (
              <div key={i} style={{ fontSize: 13, color: '#991b1b', marginBottom: i < insights!.anomalies.length - 1 ? 6 : 0, paddingLeft: 12, borderLeft: '2px solid #ef4444' }}>
                {a}
              </div>
            ))}
          </div>
        </Section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 20 }}>
        {/* Key topics */}
        {(insights?.key_topics?.length ?? 0) > 0 && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              Temas del período
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {insights!.key_topics.map((t, i) => (
                <span key={i} style={{
                  padding: '4px 10px', background: '#f0f9ff', border: '1px solid #bae6fd',
                  borderRadius: 99, fontSize: 12, color: '#0369a1',
                }}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Recommendations */}
        {(insights?.recommendations?.length ?? 0) > 0 && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              Recomendaciones
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {insights!.recommendations.map((r, i) => (
                <div key={i} style={{ fontSize: 12, color: '#374151', paddingLeft: 12, borderLeft: '2px solid #10b981', lineHeight: 1.5 }}>
                  {r}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Participants */}
      {(participants_summary?.length ?? 0) > 0 && (
        <Section title="Quién es quién">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {participants_summary!.map((p, i) => (
              <div key={i} style={{
                display: 'flex', gap: 10, alignItems: 'flex-start',
                padding: '8px 12px', background: '#f9fafb', borderRadius: 8,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                  background: `${ROLE_COLOR[p.role] ?? '#9ca3af'}22`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700, color: ROLE_COLOR[p.role] ?? '#9ca3af',
                }}>
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{p.name}</span>
                    <span style={{
                      padding: '1px 7px', borderRadius: 99, fontSize: 10, fontWeight: 600,
                      color: ROLE_COLOR[p.role] ?? '#9ca3af',
                      background: `${ROLE_COLOR[p.role] ?? '#9ca3af'}18`,
                    }}>
                      {ROLE_LABEL[p.role] ?? p.role}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.4 }}>{p.behavior}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
