'use server'

import { revalidatePath } from 'next/cache'
import { resolveChurnSignal } from '@/lib/queries'

export async function resolveChurnSignalAction(formData: FormData): Promise<void> {
  const id = Number(formData.get('id'))
  const note = (formData.get('note') as string | null) ?? undefined
  const groupId = formData.get('groupId')
  if (!Number.isFinite(id) || id <= 0) return
  await resolveChurnSignal(id, note, 'dashboard')
  // Revalidate any pages that surface churn signals so the change shows up
  // immediately without a full reload.
  revalidatePath('/')
  revalidatePath('/analytics')
  revalidatePath('/churn')
  if (groupId) revalidatePath(`/grupos/${groupId}`)
}
