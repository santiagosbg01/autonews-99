'use server'

import { revalidatePath } from 'next/cache'
import {
  updateGroupBusinessHours,
  updateGroupOperationalContext,
  VALID_BUSINESS_DAYS,
} from '@/lib/queries'

export async function saveBusinessHoursAction(formData: FormData): Promise<{
  ok: boolean
  error?: string
}> {
  const groupId = Number(formData.get('groupId'))
  const hourStart = Number(formData.get('hour_start'))
  const hourEnd = Number(formData.get('hour_end'))
  const days = VALID_BUSINESS_DAYS.filter(
    (d) => formData.get(`day_${d}`) === 'on',
  )

  if (!Number.isFinite(groupId) || groupId <= 0) {
    return { ok: false, error: 'groupId inválido' }
  }

  const result = await updateGroupBusinessHours(groupId, hourStart, hourEnd, days)
  if (!result.ok) return result

  revalidatePath(`/grupos/${groupId}`)
  revalidatePath('/grupos')
  revalidatePath('/analytics')
  return { ok: true }
}

export async function saveOperationalContextAction(formData: FormData): Promise<{
  ok: boolean
  error?: string
}> {
  const groupId = Number(formData.get('groupId'))
  const context = String(formData.get('operational_context') ?? '')

  if (!Number.isFinite(groupId) || groupId <= 0) {
    return { ok: false, error: 'groupId inválido' }
  }

  const result = await updateGroupOperationalContext(groupId, context)
  if (!result.ok) return result

  revalidatePath(`/grupos/${groupId}`)
  return { ok: true }
}
