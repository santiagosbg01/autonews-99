'use client'

import { useState } from 'react'
import type { HealthScore } from '@/lib/queries'

const BAND_STYLE: Record<HealthScore['band'], { color: string; bg: string; border: string; label: string; description: string }> = {
  critical: {
    color: '#7f1d1d', bg: '#fef2f2', border: '#fecaca', label: 'Crítico',
    description: 'Relación en riesgo. Intervención del Account Manager recomendada esta semana.',
  },
  warning: {
    color: '#b45309', bg: '#fffbeb', border: '#fed7aa', label: 'Atención',
    description: 'Indicadores en deterioro. Vale la pena un check-in con el cliente.',
  },
  watch: {
    color: '#0369a1', bg: '#eff6ff', border: '#bfdbfe', label: 'Watch',
    description: 'Salud aceptable pero con áreas de oportunidad. Vigilar la próxima semana.',
  },
  healthy: {
    color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0', label: 'Saludable',
    description: 'Todos los indicadores en niveles saludables. Sin acciones requeridas.',
  },
}

/**
 * Full-width Health Score card with breakdown bars + collapsible formula
 * explanation. Use on the group detail page or wherever there's room to
 * explain the score in detail.
 */
export default function HealthScoreCard({ health }: { health: HealthScore }) {
  const [showFormula, setShowFormula] = useState(false)
  const style = BAND_STYLE[health.band]
  const sla = health.inputs.sla_ttfr_minutes

  return (
    <div style={{
      background: '#fff',
      border: `1px solid ${style.border}`,
      borderLeft: `4px solid ${style.color}`,
      borderRadius: 14,
      padding: '20px 24px',
      marginBottom: 18,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: style.bg, border: `3px solid ${style.color}`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            color: style.color, fontWeight: 800,
          }}>
            <span style={{ fontSize: 24, lineHeight: 1 }}>{health.total}</span>
            <span style={{ fontSize: 9, fontWeight: 600, marginTop: 2, opacity: 0.8 }}>/ 100</span>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: style.color, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Client Health Score · {style.label}
            </div>
            <div style={{ fontSize: 14, color: '#0f172a', fontWeight: 600, marginTop: 2 }}>
              Salud de la relación · últimos 7 días
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 4, lineHeight: 1.5, maxWidth: 540 }}>
              {style.description}
            </div>
          </div>
        </div>

        <button
          onClick={() => setShowFormula(v => !v)}
          style={{
            background: '#f1f5f9', color: '#0f172a',
            border: '1px solid #e2e8f0', borderRadius: 8,
            padding: '6px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {showFormula ? '▲ Ocultar fórmula' : '▼ ¿Cómo se calcula?'}
        </button>
      </div>

      {/* Breakdown bars */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <Component
          label="Sentiment"
          weight={40}
          score={health.sentiment}
          rawDetail={health.inputs.avg_sentiment != null
            ? `Promedio: ${health.inputs.avg_sentiment.toFixed(2)} (rango −1 a +1)`
            : 'Sin mensajes analizados'}
        />
        <Component
          label="Resolución"
          weight={30}
          score={health.resolution}
          rawDetail={health.inputs.incidents_total_7d > 0
            ? `${health.inputs.incidents_resolved_7d} de ${health.inputs.incidents_total_7d} incidencias resueltas`
            : 'Sin incidencias en 7 días'}
        />
        <Component
          label="TTFR vs SLA"
          weight={20}
          score={health.ttfr}
          rawDetail={health.inputs.avg_ttfr_minutes != null
            ? `${health.inputs.avg_ttfr_minutes} min · SLA ${sla} min`
            : `Sin datos · SLA ${sla} min`}
        />
        <Component
          label="Escaladas"
          weight={10}
          score={health.escalations}
          rawDetail={health.inputs.incidents_total_7d > 0
            ? `${health.inputs.incidents_escalated_7d} de ${health.inputs.incidents_total_7d} escaladas`
            : 'Sin escaladas'}
        />
      </div>

      {showFormula && (
        <div style={{
          marginTop: 18,
          padding: '14px 16px',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          fontSize: 12,
          color: '#334155',
          lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Fórmula</div>
          <p style={{ margin: '0 0 10px' }}>
            Health = <strong>0.40 × Sentiment</strong> + <strong>0.30 × Resolución</strong> + <strong>0.20 × TTFR</strong> + <strong>0.10 × Escaladas</strong>
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li><strong>Sentiment (40%):</strong> promedio de mensajes en 7d normalizado de −1..+1 → 0..100. Si no hay mensajes analizados, default neutro (50).</li>
            <li><strong>Resolución (30%):</strong> % de incidencias cerradas en 7d. Sin incidencias → 100 (no se penaliza falta de actividad).</li>
            <li><strong>TTFR vs SLA (20%):</strong> 100 × min(SLA, ttfr) / max(SLA, ttfr). SLA = {sla} min. Sin datos → 100.</li>
            <li><strong>Escaladas (10%):</strong> 100 − 200 × (escaladas / total). 50% escaladas → 0; 0% → 100.</li>
          </ul>
          <div style={{ marginTop: 10, fontSize: 11, color: '#64748b' }}>
            <strong>Bandas:</strong> &lt;55 Crítico · 55–69 Atención · 70–79 Watch · ≥80 Saludable
          </div>
        </div>
      )}
    </div>
  )
}

function Component({
  label, weight, score, rawDetail,
}: { label: string; weight: number; score: number; rawDetail: string }) {
  const color = score >= 80 ? '#15803d' : score >= 60 ? '#0369a1' : score >= 45 ? '#b45309' : '#dc2626'
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>
          {label}
          <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500, marginLeft: 6 }}>{weight}%</span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color }}>{score}</div>
      </div>
      <div style={{ height: 6, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden', marginBottom: 6 }}>
        <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 99 }} />
      </div>
      <div style={{ fontSize: 11, color: '#64748b' }}>{rawDetail}</div>
    </div>
  )
}
