import 'server-only'
import { z } from 'zod'

/**
 * Server-only environment. Parsed once at import; a missing or malformed value
 * fails the build/boot rather than surfacing as a runtime `undefined`.
 *
 * Nothing here may be read from a client component — `server-only` makes that
 * a build error. See PRD-001 §3.6.
 */
const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().startsWith('sb_secret_'),
  SUPABASE_DB_URL: z.string().startsWith('postgres'),

  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(20),
  GROQ_API_KEY: z.string().startsWith('gsk_'),
  USDA_FDC_API_KEY: z.string().min(3),

  APP_ACCESS_TOKEN: z.string().min(16),

  AI_DEFAULT_CHAT_PROVIDER: z.enum(['groq', 'google']).default('groq'),
  AI_QUOTA_SAFETY_MARGIN: z.coerce.number().min(0.1).max(1).default(0.8),
  APP_TIMEZONE: z.string().default('Asia/Tokyo'),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const missing = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
  throw new Error(`Invalid environment:\n${missing.join('\n')}`)
}

export const env = parsed.data
