'use client'
import { useChat } from '@ai-sdk/react'
import { useQuery } from '@tanstack/react-query'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useCallback, useMemo, useState } from 'react'
import type { ModelsPayload } from '@/app/api/ai/models/route'
import { isModelChoice, type ModelChoice, type ModelOption } from '@/lib/domain/coach/models'
import { followUpsFor } from '@/lib/domain/coach/followUps'
import { describeSources, thinkingLabel, type SourceLine, type ToolCall } from '@/lib/domain/coach/provenance'
import { parseBlocks, type Block } from '@/lib/domain/coach/richText'

/**
 * The coach conversation, as one flat view-model.
 *
 * **Provenance is derived, not reported.** The tool calls arrive in the message stream
 * as real parts, so `DATA USED` and the `Thinking…` line are read off the calls that
 * actually happened. A route that described its own work in a side channel could drift
 * from what it did, and a receipt for work that may not have happened is worse than no
 * receipt (§3.6).
 */
export interface CoachTurn {
  id: string
  role: 'user' | 'assistant'
  /** Parsed once here, so the component maps blocks instead of parsing markdown in JSX. */
  blocks: Block[]
  sources: SourceLine[]
  /** Which model answered. Null until the reply finishes. */
  model: string | null
  degraded: boolean
  /** True while this message is still streaming. */
  isStreaming: boolean
}

export interface CoachView {
  turns: CoachTurn[]
  isEmpty: boolean
  isBusy: boolean
  /** `Reading nutrition averages: 2026-08-01 → 2026-08-07…` while tools run. */
  thinking: string | null
  error: string | null
  retry: () => void

  input: string
  setInput: (v: string) => void
  canSend: boolean
  send: (text?: string) => void
  /** Chips derived from the last answer's tools. */
  followUps: string[]
  reset: () => void

  /** Model choice, and how much of each pool is left today (US-3.7). */
  modelChoice: ModelChoice
  setModelChoice: (c: ModelChoice) => void
  modelOptions: ModelOption[]
}

/**
 * Persisted, because the reason to switch is that a pool is nearly spent — and that is
 * still true after a reload. `localStorage` rather than the database: it is a per-device
 * preference, and it must not need a round trip before the first message can be sent.
 */
const STORED_CHOICE = 'coachienta:model'

const readStoredChoice = (): ModelChoice => {
  if (typeof window === 'undefined') return 'chat'
  const stored = window.localStorage.getItem(STORED_CHOICE)
  return isModelChoice(stored) ? stored : 'chat'
}

interface Metadata {
  model?: string
  degraded?: boolean
  droppedTurns?: number
}

/**
 * Tool calls out of a message's parts.
 *
 * A tool part is `type: 'tool-<name>'` carrying `input` and, once it returns, `output`.
 * Read through a `Record` view rather than a cast: the part union is generic over the
 * tool set, so narrowing it properly here would mean threading the whole tool catalogue
 * into a client component, and `as` would just be a cast wearing a type.
 */
function toolCallsOf(message: UIMessage): ToolCall[] {
  const calls: ToolCall[] = []

  for (const part of message.parts) {
    if (!part.type.startsWith('tool-')) continue
    const fields: Record<string, unknown> = part

    const name = typeof fields.toolName === 'string' ? fields.toolName : part.type.slice(5)
    const input =
      typeof fields.input === 'object' && fields.input !== null
        ? (fields.input as Record<string, unknown>)
        : {}
    const output = typeof fields.output === 'object' && fields.output !== null ? fields.output : null
    const rowCount =
      output !== null && typeof (output as Record<string, unknown>).row_count === 'number'
        ? ((output as Record<string, unknown>).row_count as number)
        : null

    calls.push({ name, input, rowCount })
  }

  return calls
}

const textOf = (message: UIMessage): string =>
  message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')

export function useCoach(): CoachView {
  const [input, setInput] = useState('')
  const [modelChoice, setChoice] = useState<ModelChoice>(readStoredChoice)

  const models = useQuery<ModelsPayload>({
    queryKey: ['ai-models'],
    queryFn: async () => {
      const res = await fetch('/api/ai/models')
      if (!res.ok) throw new Error('models')
      return res.json()
    },
  })

  const chat = useChat({
    transport: new DefaultChatTransport({
      api: '/api/ai/chat',
      // Sent per message rather than fixed at mount, so switching mid-conversation
      // applies to the next question without resetting the thread.
      body: () => ({ model: modelChoice }),
    }),
  })

  const isBusy = chat.status === 'submitted' || chat.status === 'streaming'

  const turns = useMemo<CoachTurn[]>(
    () =>
      chat.messages.map((m, i) => {
        const meta = (m.metadata ?? {}) as Metadata
        const last = i === chat.messages.length - 1
        return {
          id: m.id,
          role: m.role === 'assistant' ? 'assistant' : 'user',
          blocks: parseBlocks(textOf(m)),
          sources: describeSources(toolCallsOf(m)),
          model: meta.model ?? null,
          degraded: meta.degraded === true,
          isStreaming: last && m.role === 'assistant' && isBusy,
        }
      }),
    [chat.messages, isBusy],
  )

  /**
   * The most recent tool that has been called but has not returned — that is the one
   * worth naming. Four seconds of "Thinking…" reads as broken, and a generic label
   * hides a wrong tool choice while it is happening (§3.8).
   */
  const thinking = useMemo(() => {
    if (!isBusy) return null
    const lastMessage = chat.messages[chat.messages.length - 1]
    if (!lastMessage || lastMessage.role !== 'assistant') return 'Thinking…'
    const calls = toolCallsOf(lastMessage)
    const running = calls.filter((c) => c.rowCount === null)
    return thinkingLabel(running[running.length - 1] ?? calls[calls.length - 1] ?? null)
  }, [chat.messages, isBusy])

  const followUps = useMemo(() => {
    const lastAssistant = [...chat.messages].reverse().find((m) => m.role === 'assistant')
    const asked = chat.messages.filter((m) => m.role === 'user').map(textOf)
    return followUpsFor(lastAssistant ? toolCallsOf(lastAssistant).map((c) => c.name) : [], asked)
  }, [chat.messages])

  const send = useCallback(
    (text?: string) => {
      const body = (text ?? input).trim()
      if (body === '' || isBusy) return
      setInput('')
      void chat.sendMessage({ text: body }).then(() => {
        // The figures only move when a reply completes, so that is when to re-read them.
        void models.refetch()
      })
    },
    [input, isBusy, chat, models],
  )

  return {
    turns,
    isEmpty: chat.messages.length === 0,
    isBusy,
    thinking,
    error: chat.error?.message ?? null,
    retry: () => void chat.regenerate(),

    input,
    setInput,
    canSend: input.trim() !== '' && !isBusy,
    send,
    followUps,
    reset: () => chat.setMessages([]),

    modelChoice,
    setModelChoice: (choice) => {
      setChoice(choice)
      window.localStorage.setItem(STORED_CHOICE, choice)
      // Usage moves as soon as a reply lands; re-read so the figures are not stale.
      void models.refetch()
    },
    modelOptions: models.data?.options ?? [],
  }
}
