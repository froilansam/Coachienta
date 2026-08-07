import 'server-only'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { env } from '@/lib/env'
import type { Provider } from './models'

const google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })
const groq = createGroq({ apiKey: env.GROQ_API_KEY })

/** One place that turns (provider, modelId) into a model handle. */
export const model = (provider: Provider, id: string) =>
  provider === 'google' ? google(id) : groq(id)
