import { getMediaAnalysis, getMediaStats, MEDIA_CATEGORY_LABELS, type MediaAnalysisRow } from '@/lib/queries'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

function fmtTime(ts: string) {
  return new Date(ts).toLocaleString('es-MX', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function CategoryBadge({ category }: { category: string | null }) {
  const meta = MEDIA_CATEGORY_LABELS[category ?? 'otro'] ?? MEDIA_CATEGORY_LABELS.otro
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
      background: `${meta.color}18`, color: meta.color, whiteSpace: 'nowrap',
    }}>
      {meta.emoji} {meta.label}
    </span>
  )
}

function MediaCard({ item }: { item: MediaAnalysisRow }) {
  const isImage = /\.(jpg|jpeg|png|gif|webp)/i.test(item.media_url.split('?')[0])
  const meta = MEDIA_CATEGORY_LABELS[item.media_category ?? 'otro'] ?? MEDIA_CATEGORY_LABELS.otro

  return (
    <div style={{
      background: '#fff', borderRadius: 12, overflow: 'hidden',
      border: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
    }}>
      {/* Image thumbnail */}
      <div style={{ position: 'relative', background: '#f8fafc', aspectRatio: '4/3', overflow: 'hidden' }}>
        {isImage ? (
          <a href={item.media_url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', height: '100%' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.media_url}
              alt={item.description ?? 'media'}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              loading="lazy"
            />
          </a>
        ) : (
          <a href={item.media_url} target="_blank" rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', textDecoration: 'none', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 40 }}>📄</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Ver documento</span>
          </a>
        )}
        {/* Category overlay */}
        <div style={{ position: 'absolute', top: 8, left: 8 }}>
          <CategoryBadge category={item.media_category} />
        </div>
        {/* Confidence */}
        {item.confidence !== null && (
          <div style={{
            position: 'absolute', top: 8, right: 8,
            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
            background: 'rgba(0,0,0,0.5)', color: '#fff',
          }}>
            {Math.round(item.confidence * 100)}%
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: '10px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <Link href={`/grupos/${item.group_id}`} style={{ fontSize: 12, fontWeight: 600, color: 'var(--brand-green)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.group_name}
          </Link>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {fmtTime(item.msg_timestamp)}
          </span>
        </div>

        {item.description && (
          <p style={{ fontSize: 12, color: '#374151', margin: 0, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {item.description}
          </p>
        )}

        {item.extracted_text && (
          <div style={{ marginTop: 2, padding: '4px 8px', background: '#f8fafc', borderRadius: 6, border: '1px solid var(--border)' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Texto extraído: </span>
            <span style={{ fontSize: 11, color: '#374151', fontFamily: 'monospace' }}>{item.extracted_text}</span>
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {item.sender_display_name ?? item.sender_phone}
          {item.caption && <span> · "{item.caption.slice(0, 60)}{item.caption.length > 60 ? '…' : ''}"</span>}
        </div>
      </div>
    </div>
  )
}

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; group?: string }>
}) {
  const sp = await searchParams
  const categoryFilter = sp.category ?? ''
  const groupIdFilter = sp.group ? parseInt(sp.group) : undefined

  const [items, stats] = await Promise.all([
    getMediaAnalysis(groupIdFilter, categoryFilter || undefined, 200),
    getMediaStats(groupIdFilter),
  ])

  const totalAnalyzed = Object.values(stats).reduce((a, b) => a + b, 0)

  function filterHref(params: Record<string, string>) {
    const merged: Record<string, string> = { category: categoryFilter }
    if (groupIdFilter) merged.group = String(groupIdFilter)
    Object.assign(merged, params)
    const clean = Object.fromEntries(Object.entries(merged).filter(([, v]) => v))
    return '/media?' + new URLSearchParams(clean).toString()
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6,
    textDecoration: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
    color: active ? '#fff' : 'var(--text-sub)',
    background: active ? 'var(--brand-green)' : 'transparent',
    border: `1px solid ${active ? 'var(--brand-green)' : 'var(--border)'}`,
  })

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/" style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none' }}>← Grupos</Link>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Galería de medios</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Imágenes y documentos clasificados con Claude Vision · {totalAnalyzed} analizados
          </p>
        </div>
      </div>

      {/* Category stats pills */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {Object.entries(MEDIA_CATEGORY_LABELS).map(([key, meta]) => {
          const count = stats[key] ?? 0
          if (count === 0) return null
          return (
            <Link key={key} href={filterHref({ category: categoryFilter === key ? '' : key })}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
                borderRadius: 99, textDecoration: 'none', border: `1px solid ${meta.color}40`,
                background: categoryFilter === key ? `${meta.color}18` : '#fff',
                fontSize: 12, fontWeight: 600, color: meta.color,
              }}>
              <span>{meta.emoji}</span>
              <span>{meta.label}</span>
              <span style={{ background: `${meta.color}30`, borderRadius: 99, padding: '1px 7px', fontSize: 11 }}>{count}</span>
            </Link>
          )
        })}
        {categoryFilter && (
          <Link href={filterHref({ category: '' })} style={{ ...tabStyle(false), fontSize: 12 }}>
            ✕ Limpiar filtro
          </Link>
        )}
      </div>

      {/* Empty state */}
      {items.length === 0 && (
        <div className="card" style={{ padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🖼️</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
            Sin imágenes analizadas aún
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 480, margin: '0 auto', lineHeight: 1.6 }}>
            Las imágenes y documentos se descargan automáticamente cuando llegan al listener.
            Para analizar las existentes, corre:
          </div>
          <code style={{ display: 'inline-block', marginTop: 12, padding: '8px 16px', background: '#f3f4f6', borderRadius: 8, fontSize: 13 }}>
            woi-analyze analyze-media
          </code>
        </div>
      )}

      {/* Media grid */}
      {items.length > 0 && (
        <>
          <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            {items.length} imagen{items.length !== 1 ? 'es' : ''} {categoryFilter ? `· filtro: ${MEDIA_CATEGORY_LABELS[categoryFilter]?.label}` : ''}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 16,
          }}>
            {items.map(item => (
              <MediaCard key={item.id} item={item} />
            ))}
          </div>
        </>
      )}

      <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>
        Análisis con Claude Vision · imágenes almacenadas en Supabase Storage (bucket: woi-media)
      </div>
    </div>
  )
}
