import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const incidentId = parseInt(id, 10)
  if (isNaN(incidentId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body: { status?: string; changed_by?: string; reason?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })
  }

  const { status, changed_by = 'ops_user', reason } = body
  const VALID = ['abierto', 'respondido', 'pendiente', 'escalado', 'resuelto', 'no_resuelto_eod']
  if (!status || !VALID.includes(status)) {
    return NextResponse.json({ error: `status must be one of: ${VALID.join(', ')}` }, { status: 400 })
  }

  // Read current status for the audit trail
  const { data: current, error: readErr } = await supabaseAdmin
    .from('incidents')
    .select('status')
    .eq('id', incidentId)
    .single()

  if (readErr || !current) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }

  // Update incident
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { status, updated_at: now }
  if (status === 'escalado' && !current.status?.startsWith('escalado')) {
    patch.escalated_at = now
    if (reason) patch.escalated_reason = reason
  }

  const { error: updateErr } = await supabaseAdmin
    .from('incidents')
    .update(patch)
    .eq('id', incidentId)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // Write audit log
  const { error: logErr } = await supabaseAdmin
    .from('ticket_status_logs')
    .insert({
      incident_id: incidentId,
      changed_by:  changed_by.trim() || 'ops_user',
      from_status: current.status ?? null,
      to_status:   status,
      reason:      reason ?? null,
      source:      'manual',
    })

  if (logErr) {
    console.error('[ticket-status-log] failed to write log:', logErr.message)
  }

  return NextResponse.json({ ok: true, from: current.status, to: status })
}
