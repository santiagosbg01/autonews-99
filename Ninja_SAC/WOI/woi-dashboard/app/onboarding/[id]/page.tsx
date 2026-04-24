import { getGroupDetail, getGroupParticipants } from '@/lib/queries'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import ParticipantMapper from './ParticipantMapper'

export const revalidate = 0

export default async function OnboardingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const groupId = parseInt(id)
  if (isNaN(groupId)) notFound()

  const [group, participants] = await Promise.all([
    getGroupDetail(groupId),
    getGroupParticipants(groupId),
  ])

  if (!group) notFound()

  return (
    <div>
      <div className="mb-6">
        <Link href={`/grupos/${group.id}`} style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none' }}>
          ← {group.name}
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 8 }}>Mapeo de participantes</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>
          Clasifica cada número como cliente, agente de 99 o irrelevante.
          Los agentes conocidos ya están clasificados automáticamente.
        </p>
      </div>

      <ParticipantMapper participants={participants} groupId={groupId} />
    </div>
  )
}
