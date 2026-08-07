import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'

/**
 * The only Supabase client in the app. Server-side, secret key, no RLS.
 * There is no browser client by design — see PRD-001 §3.6.
 */
export const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
