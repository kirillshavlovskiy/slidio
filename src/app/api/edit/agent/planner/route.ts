import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { assertWithinQuota, QuotaExceededError } from '@/lib/billing/usage'
import { runPlannerAgent } from '@/lib/agent/planner/runPlannerAgent'
import type { PlannerStreamEvent } from '@/lib/agent/planner/types'
import { coerceAgentEffort, type Effort } from '@/lib/agent/models'

export const maxDuration = 120
export const runtime = 'nodejs'

function encode(event: PlannerStreamEvent): Uint8Array {
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
    userInstruction?: string
    knowledgeContext?: string
    currentDeckSlideCount?: number
    currentDeckTitles?: string[]
    effort?: Effort
    resume?: string
  }

  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400 })
  }

  if (!body.userInstruction?.trim()) {
    return new Response(JSON.stringify({ error: 'userInstruction required' }), { status: 400 })
  }

  const effort = coerceAgentEffort(body.effort)

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (event: PlannerStreamEvent) => {
        try {
          controller.enqueue(encode(event))
        } catch {
          /* client disconnected */
        }
      }

      void (async () => {
        try {
          const result = await runPlannerAgent({
            userInstruction: body.userInstruction!,
            knowledgeContext: body.knowledgeContext ?? '',
            currentDeckSlideCount: body.currentDeckSlideCount ?? 0,
            currentDeckTitles: body.currentDeckTitles ?? [],
            effort,
            resume: body.resume,
            onEvent: push,
            abortSignal: req.signal,
          })
          if (result.sessionId) {
            push({ type: 'session_init', sessionId: result.sessionId })
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          push({ type: 'error', message })
        } finally {
          controller.close()
        }
      })()
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
