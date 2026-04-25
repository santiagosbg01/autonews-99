'use client'

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html>
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', margin: 0, background: '#f9fafb' }}>
        <div style={{ textAlign: 'center', maxWidth: 400, padding: '40px 24px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>Algo salió mal</h2>
          <p style={{ color: '#6b7280', fontSize: 14, margin: '0 0 24px' }}>Ocurrió un error inesperado.</p>
          <button
            onClick={reset}
            style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}
          >
            Intentar de nuevo
          </button>
        </div>
      </body>
    </html>
  )
}
