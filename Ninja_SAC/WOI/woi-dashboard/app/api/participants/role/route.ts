import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function PATCH(req: NextRequest) {
  const { participantId, role } = await req.json()

  if (!participantId || !role) {
    return NextResponse.json({ error: 'Missing participantId or role' }, { status: 400 })
  }

  const validRoles = ['cliente', 'agente_99', 'otro']
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('participants')
    .update({ role, confirmed_by_santi: true })
    .eq('id', participantId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
