import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import {
  assertWithinQuota,
  recordTokenUsage,
  usageTokens,
  QuotaExceededError,
} from '@/lib/billing/usage'
import { compressAgentIntro } from '@/lib/presentationScope'
import {
  buildAgentSystemPrompt,
  cachedAgentTools,
} from '@/lib/agent/prompts'
import {
  anthropicToolsToOpenAI,
  anthropicMessagesToOpenAI,
  openAIResponseToBlocks,
} from '@/lib/agent/openaiTools'
import {
  type AgentPhase,
  type Effort,
  agentModel,
  agentThinkingBudget,
  agentMaxTokens,
  coerceAgentEffort,
  getAgentProvider,
} from '@/lib/agent/models'
import OpenAI from 'openai'

/** Vercel Pro caps serverless functions at 300s — stay under that per step. */
export const maxDuration = 300

const client = new Anthropic()
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

/** Abort a single agent step before the platform kills the whole function. */
const STEP_TIMEOUT_MS = Number(process.env.AGENT_STEP_TIMEOUT_MS) || 240_000

class StepTimeoutError extends Error {
  status = 504
  constructor() {
    super('Agent step exceeded server time limit')
    this.name = 'StepTimeoutError'
  }
}

async function withStepTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StepTimeoutError()), STEP_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Single model for all agent steps — see agentModel() in src/lib/agent/models.ts.
 */
const VALID_EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
function coerceEffort(e: unknown, fallback: Effort): Effort {
  return typeof e === 'string' && (VALID_EFFORTS as string[]).includes(e) ? (e as Effort) : fallback
}

function coercePhase(p: unknown): AgentPhase {
  return p === 'review' ? 'review' : 'execute'
}

/**
 * Token / thinking budget — reasoning is ALWAYS enabled for agent steps.
 */
function budgetFor(effort: Effort): {
  maxTokens: number
  thinking: Anthropic.MessageCreateParams['thinking']
} {
  const e = coerceAgentEffort(effort)
  return {
    maxTokens: agentMaxTokens(e),
    thinking: { type: 'enabled', budget_tokens: agentThinkingBudget(e) },
  }
}

function agentLog(reqId: string, label: string, ...rest: unknown[]) {
  console.log(`[agent ${reqId}] ${label}`, ...rest)
}

/**
 * Agentic, tool-using slide editor (mirrors how Claude edits PowerPoint directly):
 * the model inspects the slide, RENDERS it to see the result, applies changes, and
 * re-renders to verify — looping until it is satisfied. This endpoint runs ONE model
 * turn per request; the CLIENT executes the tools (it owns the real renderer + slide
 * state) and calls back with tool results until the model calls `finish`.
 */

type Block = Anthropic.ContentBlockParam

/**
 * Shrink the conversation before sending it back to the model. The tool-loop
 * history is dominated by (a) full-slide JSON returned by get_slide(s),
 * (b) render screenshots, and (c) thinking blocks (kept in context by default
 * on Sonnet 4.6+, so they add INPUT tokens every turn) — all grow each step and
 * quickly blow past the input-token rate limit. We keep the MOST RECENT
 * tool-result turn in full (that's what the model is reacting to) and compact
 * everything older: strip stale screenshots, truncate long slide dumps, and drop
 * thinking blocks from all but the latest assistant turn (adaptive thinking
 * permits prior assistant turns without leading thinking blocks).
 */
function trimMessages(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const MAX_TEXT = 1200
  const isToolResultTurn = (m: Anthropic.MessageParam) =>
    Array.isArray(m.content) && (m.content as Block[]).some(b => b.type === 'tool_result')

  // Index of the freshest tool-result turn — keep it untouched.
  let lastToolResultIdx = -1
  // Index of the freshest assistant turn — keep its thinking blocks for continuity.
  let lastAssistantIdx = -1
  messages.forEach((m, i) => {
    if (isToolResultTurn(m)) lastToolResultIdx = i
    if (m.role === 'assistant') lastAssistantIdx = i
  })

  return messages.map((m, i) => {
    // Compress the heavy intro blob after the first turn — knowledge/docs must not
    // be re-sent on every step (dominant token cost on deck builds).
    if (
      i === 0 &&
      m.role === 'user' &&
      typeof m.content === 'string' &&
      m.content.length > 6000
    ) {
      const instrMatch = m.content.match(/^User instruction: "((?:[^"\\]|\\.)*)"/)
      const instruction = instrMatch?.[1]?.replace(/\\"/g, '"') ?? ''
      return { ...m, content: compressAgentIntro(m.content, instruction) }
    }
    if (!Array.isArray(m.content)) return m
    // Drop stale thinking blocks from older assistant turns to save input tokens.
    if (m.role === 'assistant' && i !== lastAssistantIdx) {
      const pruned = (m.content as Block[]).filter(
        b => b.type !== 'thinking' && b.type !== 'redacted_thinking'
      )
      if (pruned.length !== (m.content as Block[]).length) return { ...m, content: pruned }
      return m
    }
    if (i === lastToolResultIdx) return m
    const content = (m.content as Block[]).map(b => {
      if (b.type !== 'tool_result') return b
      const tr = b as Anthropic.ToolResultBlockParam
      if (typeof tr.content === 'string') {
        return tr.content.length > MAX_TEXT
          ? { ...tr, content: tr.content.slice(0, MAX_TEXT) + ' …[truncated to save tokens]' }
          : tr
      }
      if (Array.isArray(tr.content)) {
        const compacted = tr.content.map(cb => {
          if (cb.type === 'image')
            return { type: 'text', text: '[screenshot omitted to save tokens]' }
          if (cb.type === 'text' && cb.text.length > MAX_TEXT)
            return { ...cb, text: cb.text.slice(0, MAX_TEXT) + ' …[truncated]' }
          return cb
        })
        return { ...tr, content: compacted }
      }
      return tr
    })
    return { ...m, content }
  }) as Anthropic.MessageParam[]
}

function isOverloadedError(err: unknown): boolean {
  const status = (err as { status?: number })?.status
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return status === 529 || msg.includes('overloaded')
}

function classifyRetryableAnthropicError(
  err: unknown
): { kind: 'rate_limit' | 'overloaded'; waitMs: number } | null {
  const status = (err as { status?: number })?.status
  const headers = (err as { headers?: Record<string, string> })?.headers
  const retryAfter = Number(headers?.['retry-after']) || 0

  if (status === 429) {
    return {
      kind: 'rate_limit',
      waitMs: Math.min(Math.max(retryAfter * 1000, 5000), 35000),
    }
  }
  if (isOverloadedError(err)) {
    return { kind: 'overloaded', waitMs: 0 }
  }
  return null
}

async function createWithRetry(
  params: Anthropic.MessageCreateParamsNonStreaming,
  reqId: string
): Promise<Anthropic.Message> {
  const MAX_RETRIES = 3
  const OVERLOADED_BACKOFF_MS = [8000, 20000, 45000]
  for (let attempt = 0; ; attempt++) {
    try {
      // Stream and collect the final message. The SDK rejects a NON-streaming
      // request whose max_tokens is large enough to risk a >10-min response
      // ("Streaming is required…") — which is exactly the high/xhigh/max budgets
      // the router sends to Sonnet. Streaming avoids that guard and works at any
      // token size; finalMessage() yields the same Message a create() would.
      return await client.messages.stream(params).finalMessage()
    } catch (err) {
      const retryable = classifyRetryableAnthropicError(err)
      if (retryable && attempt < MAX_RETRIES) {
        const waitMs =
          retryable.kind === 'overloaded'
            ? OVERLOADED_BACKOFF_MS[attempt] ?? 45000
            : retryable.waitMs
        agentLog(
          reqId,
          `${retryable.kind} — retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
        )
        await new Promise(r => setTimeout(r, waitMs))
        continue
      }
      throw err
    }
  }
}

export async function POST(req: NextRequest) {
  const reqId = Math.random().toString(36).slice(2, 8)

  // Gate each agent step on the user's token quota.
  const session = await auth()
  const userId = session?.user?.id
  if (userId) {
    try {
      await assertWithinQuota(userId)
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json({ error: err.message }, { status: 402 })
      }
      throw err
    }
  }

  let body: {
    messages?: Anthropic.MessageParam[]
    effort?: Effort
    phase?: AgentPhase
    layoutAudit?: boolean
    geometryOnly?: boolean
    deckBuild?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const messages = body.messages
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 })
  }

  // Effort is the soft token-spend dial: the router sends a higher level for
  // ambitious multi-slide / redesign work and a lower one for simple edits.
  const effort = coerceAgentEffort(coerceEffort(body.effort, 'medium'))
  const phase = coercePhase(body.phase)
  const deckBuild = body.deckBuild === true
  const { maxTokens, thinking } = budgetFor(effort)
  const model = agentModel()
  const provider = getAgentProvider()

  agentLog(
    reqId,
    `step — ${messages.length} message(s) · provider=${provider} · phase=${phase} · effort=${effort} · model=${model} · maxTokens=${maxTokens}` +
      (deckBuild ? ' · deckBuild' : '')
  )

  type AgentBlock =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: 'thinking'; thinking: string; signature?: string }
    | { type: 'redacted_thinking'; data: string }

  let content: AgentBlock[]
  let stop_reason: string

  try {
    if (provider === 'openai') {
      const systemText = buildAgentSystemPrompt({ deckBuild })
      const completion = await withStepTimeout(
        openai.chat.completions.create({
          model,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: systemText },
            ...anthropicMessagesToOpenAI(
              messages as Array<{
                role: 'user' | 'assistant'
                content: string | Array<{ type: string; [key: string]: unknown }>
              }>
            ),
          ],
          tools: anthropicToolsToOpenAI(cachedAgentTools() as Anthropic.Tool[]),
          tool_choice: 'auto',
        })
      )
      const msg = completion.choices[0]?.message
      if (!msg) throw new Error('OpenAI returned empty message')
      const raw = openAIResponseToBlocks(msg)
      content = raw.map(b => {
        if (b.type === 'text' && b.text.includes('[REASONING]')) {
          const parts = b.text.split('[REASONING]')
          const blocks: AgentBlock[] = []
          if (parts[0]?.trim()) blocks.push({ type: 'text', text: parts[0].trim() })
          if (parts[1]?.trim()) blocks.push({ type: 'thinking', thinking: parts[1].trim() })
          return blocks
        }
        return b
      }).flat()
      stop_reason = msg.tool_calls?.length ? 'tool_use' : 'end_turn'
      if (userId && completion.usage) {
        void recordTokenUsage(
          userId,
          completion.usage.prompt_tokens + completion.usage.completion_tokens
        ).catch(() => {})
      }
    } else {
      const response = await withStepTimeout(
        createWithRetry(
          {
            model,
            max_tokens: maxTokens,
            system: [
              {
                type: 'text',
                text: buildAgentSystemPrompt({ deckBuild }),
                cache_control: { type: 'ephemeral' },
              },
            ],
            tools: cachedAgentTools(),
            tool_choice: { type: 'auto' },
            messages: trimMessages(messages),
            thinking,
          },
          reqId
        )
      )
      if (userId) {
        void recordTokenUsage(userId, usageTokens(response.usage)).catch(() => {})
      }
      content = response.content
        .filter(
          (block): block is Anthropic.TextBlock | Anthropic.ToolUseBlock | Anthropic.ThinkingBlock | Anthropic.RedactedThinkingBlock =>
            block.type === 'text' ||
            block.type === 'tool_use' ||
            block.type === 'thinking' ||
            block.type === 'redacted_thinking'
        )
        .map(block => {
        if (block.type === 'text') return { type: 'text', text: block.text }
        if (block.type === 'tool_use') {
          return { type: 'tool_use', id: block.id, name: block.name, input: block.input }
        }
        if (block.type === 'thinking') {
          return { type: 'thinking', thinking: block.thinking, signature: block.signature }
        }
        if (block.type === 'redacted_thinking') {
          return { type: 'redacted_thinking', data: block.data }
        }
        return block as AgentBlock
      })
      stop_reason = response.stop_reason ?? 'end_turn'
    }
  } catch (err) {
    if (err instanceof StepTimeoutError) {
      agentLog(reqId, `step timed out after ${STEP_TIMEOUT_MS}ms`)
      return NextResponse.json(
        {
          error:
            'This agent step took too long (server limit). Say "continue" to retry, or narrow scope (fewer slides per run).',
        },
        { status: 504 }
      )
    }
    const status = (err as { status?: number })?.status
    agentLog(reqId, 'MODEL CALL FAILED:', err instanceof Error ? err.message : err)
    if (status === 429) {
      return NextResponse.json(
        {
          error:
            'Anthropic rate limit reached (your tier allows 30k input tokens/min). Wait ~60s, then say "continue" — agent context and deck edits are preserved.',
          transient: 'rate_limit',
        },
        { status: 429 }
      )
    }
    if (isOverloadedError(err)) {
      return NextResponse.json(
        {
          error:
            'Anthropic API is temporarily overloaded. Wait ~30s, then say "continue" — agent context and deck edits are preserved.',
          transient: 'overloaded',
        },
        { status: 503 }
      )
    }
    // Surface the real reason (e.g. invalid_request) instead of an opaque
    // "model call failed" so problems are actionable and not silent.
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `Model call failed${detail ? `: ${detail.slice(0, 300)}` : ''}` },
      { status: 502 }
    )
  }

  const toolUses = content.filter(b => b.type === 'tool_use')
  agentLog(
    reqId,
    `stop_reason=${stop_reason} · tools=${toolUses.map(t => t.name).join(',') || 'none'}`
  )

  return NextResponse.json({ content, stop_reason })
}
