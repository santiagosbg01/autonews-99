'use server'

import { revalidatePath } from 'next/cache'
import {
  recordIncidentFeedback,
  type FeedbackField,
} from '@/lib/queries'

const VALID_FIELDS = new Set<FeedbackField>(['category', 'urgency', 'sentiment', 'bucket', 'summary', 'other'])
const VALID_URGENCY = new Set(['baja', 'media', 'alta'])

/**
 * Server action invoked from the ticket detail page.
 *
 * Form fields (multipart):
 *   incidentId    — required
 *   groupId       — optional, used for revalidation
 *   field         — one of FeedbackField
 *   oldValue      — current/previous value (for the audit log)
 *   newValue      — new value (the correction)
 *   reason        — optional free text
 *   submittedBy   — optional, defaults to 'dashboard'
 */
export async function submitIncidentFeedbackAction(formData: FormData): Promise<void> {
  const incidentId  = Number(formData.get('incidentId'))
  if (!Number.isFinite(incidentId) || incidentId <= 0) return

  const field = String(formData.get('field') ?? '') as FeedbackField
  if (!VALID_FIELDS.has(field)) return

  const rawOld = formData.get('oldValue')
  const rawNew = formData.get('newValue')
  const reason = formData.get('reason')
  const submittedBy = formData.get('submittedBy')
  const groupId = formData.get('groupId')

  const oldValue = rawOld != null ? String(rawOld).trim() || null : null
  const newValue = rawNew != null ? String(rawNew).trim() || null : null

  // Skip no-ops
  if ((oldValue ?? '') === (newValue ?? '')) return

  // Field-specific validation
  if (field === 'urgency' && newValue && !VALID_URGENCY.has(newValue)) return
  if (field === 'sentiment' && newValue) {
    const n = Number(newValue)
    if (!Number.isFinite(n) || n < -1 || n > 1) return
  }

  await recordIncidentFeedback({
    incidentId,
    field,
    oldValue,
    newValue,
    reason: reason ? String(reason).trim() || null : null,
    submittedBy: submittedBy ? String(submittedBy) : 'dashboard',
  })

  // Revalidate everything that might display the incident or aggregate counts.
  revalidatePath(`/tickets/${incidentId}`)
  revalidatePath('/tickets')
  revalidatePath('/analytics')
  if (groupId) revalidatePath(`/grupos/${groupId}`)
  revalidatePath('/')
}
