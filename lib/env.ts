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
  /**
   * Says whether the variable is ABSENT or merely wrong, because those have different
   * fixes and Zod reports both as "Invalid input".
   *
   * A Vercel build failed with `SUPABASE_URL: Invalid input`, which reads as "the value
   * is malformed" when the variable had simply never been added to that environment.
   * The distinction is one line here and saves a deploy cycle to discover.
   *
   * The value itself is never echoed — build logs are not a safe place for a key, and
   * `startsWith` failures would otherwise print most of one.
   */
  const detail = parsed.error.issues.map((issue) => {
    const name = String(issue.path[0])
    const supplied = process.env[name]
    return supplied === undefined || supplied === ''
      ? `  ${name}: not set in this environment`
      : `  ${name}: set, but rejected — ${issue.message}`
  })

  throw new Error(
    `Invalid environment:\n${detail.join('\n')}\n\n` +
      'Every variable in .env.example is required. On Vercel they must be added for the ' +
      'environment being built (Production, Preview and Development are separate lists), ' +
      'and a deploy triggered BEFORE they were added will still fail — redeploy after.',
  )
}

export const env = parsed.data
