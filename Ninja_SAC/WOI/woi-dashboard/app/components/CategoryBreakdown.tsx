const BUCKET_FOR_CATEGORY: Record<string, 'A' | 'B' | 'C'> = {
  presentacion_unidad: 'A', presentacion_chofer: 'A', presentacion_auxiliar: 'A',
  confirmacion_llegada: 'A', confirmacion_salida: 'A', reporte_entrega: 'A',
  confirmacion_evidencias: 'A',
  problema_unidad: 'B', problema_horario: 'B', problema_entrada: 'B',
  problema_salida: 'B', problema_trafico: 'B', problema_manifestacion: 'B',
  robo_incidencia: 'B', problema_sistema: 'B', problema_proveedor: 'B',
  acuse_recibo: 'C', confirmacion_resolucion: 'C', consulta_info: 'C',
  saludo_ruido: 'C', otro: 'C',
}

const LABEL_ES: Record<string, string> = {
  presentacion_unidad: 'Pres. unidad',
  presentacion_chofer: 'Pres. chofer',
  presentacion_auxiliar: 'Pres. auxiliar',
  confirmacion_llegada: 'Conf. llegada',
  confirmacion_salida: 'Conf. salida',
  reporte_entrega: 'Reporte entrega',
  confirmacion_evidencias: 'Evidencias',
  problema_unidad: 'Problema unidad',
  problema_horario: 'Problema horario',
  problema_entrada: 'Problema entrada',
  problema_salida: 'Problema salida',
  problema_trafico: 'Tráfico',
  problema_manifestacion: 'Manifestación',
  robo_incidencia: 'Robo / incidencia',
  problema_sistema: 'Problema sistema',
  problema_proveedor: 'Problema proveedor',
  acuse_recibo: 'Acuse recibo',
  confirmacion_resolucion: 'Resolución',
  consulta_info: 'Consulta info',
  saludo_ruido: 'Saludo / ruido',
  otro: 'Otro',
}

const BUCKET_COLOR: Record<string, string> = {
  A: '#10b981',
  B: '#ef4444',
  C: '#94a3b8',
}

const BUCKET_BG: Record<string, string> = {
  A: '#ecfdf5',
  B: '#fef2f2',
  C: '#f1f5f9',
}

const BUCKET_LABEL: Record<string, string> = {
  A: 'Operativos',
  B: 'Incidencias',
  C: 'Ruido',
}

const BUCKET_DESC: Record<string, string> = {
  A: 'Confirmaciones, presentaciones y reportes de entrega — operación corriendo bien.',
  B: 'Problemas reportados (unidad, horario, sistema, robo) — requieren atención.',
  C: 'Saludos, acuses, consultas y mensajes sin información operativa accionable.',
}

export default function CategoryBreakdown({ counts }: { counts: Record<string, number> }) {
  if (!counts || Object.keys(counts).length === 0) {
    return (
      <div style={{ padding: '20px', color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>
        Sin mensajes clasificados aún
      </div>
    )
  }

  const total = Object.values(counts).reduce((s, n) => s + n, 0)
  const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a)
  const maxVal = sorted[0]?.[1] ?? 1

  // Group by bucket
  const byBucket: Record<string, [string, number][]> = { A: [], B: [], C: [] }
  for (const [cat, n] of sorted) {
    const bucket = BUCKET_FOR_CATEGORY[cat] ?? 'C'
    byBucket[bucket].push([cat, n])
  }

  return (
    <div style={{ padding: '16px 20px' }}>
      {/* Bucket summary pills */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        {(['A', 'B', 'C'] as const).map(b => {
          const cnt = byBucket[b].reduce((s, [, n]) => s + n, 0)
          const pct = total > 0 ? Math.round(cnt / total * 100) : 0
          return (
            <div key={b} style={{
              flex: 1, padding: '10px 14px', borderRadius: 10,
              background: BUCKET_BG[b], border: `1px solid ${BUCKET_COLOR[b]}33`,
              textAlign: 'center',
            }}
              title={BUCKET_DESC[b]}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: BUCKET_COLOR[b], marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {BUCKET_LABEL[b]}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: BUCKET_COLOR[b] }}>{cnt}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>{pct}%</div>
            </div>
          )
        })}
      </div>

      {/* Legend / disclaimer */}
      <div style={{
        fontSize: 11, color: '#475569', background: '#f8fafc',
        border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px',
        marginBottom: 16, lineHeight: 1.45,
      }}>
        <strong style={{ color: '#0f172a' }}>¿Qué significan los buckets?</strong>{' '}
        <span style={{ color: BUCKET_COLOR.A, fontWeight: 600 }}>Operativos</span> = confirmaciones / presentaciones / reportes ·{' '}
        <span style={{ color: BUCKET_COLOR.B, fontWeight: 600 }}>Incidencias</span> = problemas reportados ·{' '}
        <span style={{ color: BUCKET_COLOR.C, fontWeight: 600 }}>Ruido</span> = saludos, acuses y consultas sin información accionable.
        Las métricas (TTFR, sentiment) se calculan sobre Operativos + Incidencias.
      </div>

      {/* Per-category bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sorted.map(([cat, n]) => {
          const bucket = BUCKET_FOR_CATEGORY[cat] ?? 'C'
          const color = BUCKET_COLOR[bucket]
          const pct = Math.round(n / maxVal * 100)
          const totalPct = total > 0 ? ((n / total) * 100).toFixed(0) : '0'
          return (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 130, fontSize: 12, color: '#374151', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {LABEL_ES[cat] ?? cat.replace(/_/g, ' ')}
              </div>
              <div style={{ flex: 1, height: 6, background: '#f3f4f6', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.3s' }} />
              </div>
              <div style={{ width: 42, textAlign: 'right', fontSize: 12, color: '#6b7280' }}>
                {n} <span style={{ color: '#d1d5db' }}>({totalPct}%)</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
