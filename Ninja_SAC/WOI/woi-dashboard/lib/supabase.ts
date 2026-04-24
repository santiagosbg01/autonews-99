import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, anon)
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key)
}

export const supabase = new Proxy({} as ReturnType<typeof getSupabase>, {
  get: (_, prop) => getSupabase()[prop as keyof ReturnType<typeof getSupabase>],
})

export const supabaseAdmin = new Proxy({} as ReturnType<typeof getSupabaseAdmin>, {
  get: (_, prop) => getSupabaseAdmin()[prop as keyof ReturnType<typeof getSupabaseAdmin>],
})
