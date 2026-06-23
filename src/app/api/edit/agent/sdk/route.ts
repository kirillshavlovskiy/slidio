import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import {
  assertWithinQuota,
  recordTokenUsage,
  QuotaExceededError,
} from '@/lib/billing/usage'
import { runDeckAgentSession } from '@/lib/agent/claudeSdk/runDeckAgent'
import type { DeckAgentStreamEvent } from '@/lib/agent/claudeSdk/types'
import {
  coerceAgentEffort,
  type Effort,
} from '@/lib/agent/models'
import type { SlideData } from '@/lib/types'

export const maxDuration = 300
export const runtime = 'nodejs'

function encodeEvent(event: DeckAgentStreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (userId) {
    try {
      await assertWithinQuota(userId)
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return new Response(JSON.stringify({ error: err.message }), { status: 402 })
      }
      throw err
    }
  }

  let body: {
    prompt?: string
    slides?: SlideData[]
    effort?: Effort
    deckBuild?: boolean
    geometryOnly?: boolean
    layoutAudit?: boolean
    resume?: string
    systemContext?: string
  }

  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400 })
  }

  if (!body.prompt?.trim()) {
    return new Response(JSON.stringify({ error: 'prompt required' }), { status: 400 })
  }
  if (!Array.isArray(body.slides)) {
    return new Response(JSON.stringify({ error: 'slides required' }), { status: 400 })
  }

  const effort = coerceAgentEffort(body.effort)
  const abortSignal = req.signal

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (event: DeckAgentStreamEvent) => {
        try {
          controller.enqueue(encodeEvent(event))
        } catch {
          /* client disconnected */
        }
      }

      void (async () => {
        try {
          const result = await runDeckAgentSession({
            prompt: body.prompt!,
            slides: body.slides!,
            effort,
            deckBuild: body.deckBuild === true,
            geometryOnly: body.geometryOnly === true,
            layoutAudit: body.layoutAudit === true,
            resume: body.resume,
            systemContext: body.systemContext,
            onEvent: push,
            abortSignal,
          })

          if (userId && result.totalTokens) {
            void recordTokenUsage(userId, result.totalTokens).catch(() => {})
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          push({ type: 'error', message })
        } finally {
          controller.close()
        }
      })()
    },
    cancel() {
      /* fetch aborted */
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
