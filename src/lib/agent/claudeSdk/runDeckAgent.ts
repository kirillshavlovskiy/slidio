import { query } from '@anthropic-ai/claude-agent-sdk'
import {
  agentMaxTokens,
  agentModel,
  coerceAgentEffort,
  type Effort,
} from '@/lib/agent/models'
import { buildAgentSystemPrompt } from '@/lib/agent/prompts'
import type { SlideData } from '@/lib/types'
import { AskUserPause, DeckAgentSession } from '@/lib/agent/claudeSdk/deckSession'
import {
  createDeckMcpServer,
  DECK_MCP_TOOL_NAMES,
} from '@/lib/agent/claudeSdk/mcpServer'
import type {
  DeckAgentSessionResult,
  DeckAgentStreamEvent,
} from '@/lib/agent/claudeSdk/types'

const SDK_MODE_NOTE =
  '\n\n[AGENT SDK MODE] render_slide returns programmatic layout diagnostics instead of PNG screenshots. Trust LAYOUT CHECK output from apply_changes.'

function effortToSdk(effort: Effort): 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  const e = coerceAgentEffort(effort)
  return e
}

function extractAssistantText(message: {
  type: string
  message?: { content?: unknown[] }
}): string {
  if (message.type !== 'assistant' || !Array.isArray(message.message?.content)) return ''
  return message.message.content
    .map(block => {
      if (
        typeof block === 'object' &&
        block !== null &&
        'type' in block &&
        (block as { type: string }).type === 'text' &&
        'text' in block
      ) {
        return String((block as { text: string }).text)
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

function extractThinking(message: {
  type: string
  message?: { content?: unknown[] }
}): string {
  if (message.type !== 'assistant' || !Array.isArray(message.message?.content)) return ''
  return message.message.content
    .map(block => {
      if (
        typeof block === 'object' &&
        block !== null &&
        'type' in block &&
        (block as { type: string }).type === 'thinking' &&
        'thinking' in block
      ) {
        return String((block as { thinking: string }).thinking)
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

export async function runDeckAgentSession(params: {
  prompt: string
  slides: SlideData[]
  effort: Effort
  deckBuild?: boolean
  geometryOnly?: boolean
  layoutAudit?: boolean
  maxTurns?: number
  resume?: string
  onEvent: (event: DeckAgentStreamEvent) => void
  abortSignal?: AbortSignal
}): Promise<DeckAgentSessionResult> {
  const session = new DeckAgentSession(params.slides)
  const deckServer = createDeckMcpServer(session, params.onEvent)
  const abortController = new AbortController()
  if (params.abortSignal) {
    if (params.abortSignal.aborted) abortController.abort()
    else params.abortSignal.addEventListener('abort', () => abortController.abort(), { once: true })
  }

  const systemPrompt =
    buildAgentSystemPrompt({
      deckBuild: params.deckBuild,
      geometryOnly: params.geometryOnly,
      layoutAudit: params.layoutAudit,
    }) + SDK_MODE_NOTE

  let sessionId: string | undefined
  let costUsd: number | undefined
  let numTurns: number | undefined
  let totalTokens = 0
  let askUser: DeckAgentSessionResult['askUser']

  try {
    const q = query({
      prompt: params.prompt,
      options: {
        model: agentModel(),
        maxTurns: params.maxTurns ?? 30,
        effort: effortToSdk(params.effort),
        systemPrompt,
        mcpServers: { deck: deckServer },
        strictMcpConfig: true,
        allowedTools: [...DECK_MCP_TOOL_NAMES],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: [],
        persistSession: false,
        abortController,
        resume: params.resume,
        ...(process.env.CLAUDE_CODE_EXECUTABLE
          ? { pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE }
          : {}),
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        },
        stderr: line => {
          if (line.trim()) console.error('[claude-agent-sdk]', line.trim())
        },
      },
    })

    for await (const message of q) {
      if (message.type === 'system' && message.subtype === 'init') {
        sessionId = message.session_id
      }

      if (message.type === 'assistant') {
        const thinking = extractThinking(message)
        if (thinking) {
          params.onEvent({ type: 'step', kind: 'thinking', label: thinking })
        }

        const text = extractAssistantText(message)
        if (text) {
          params.onEvent({ type: 'step', kind: 'note', label: text })
        }
      }

      if (message.type === 'result') {
        sessionId = message.session_id
        costUsd = message.total_cost_usd
        numTurns = message.num_turns
        totalTokens =
          (message.usage?.input_tokens ?? 0) + (message.usage?.output_tokens ?? 0)
        if (message.subtype === 'success') {
          if (!session.summary && message.result) session.summary = message.result
        } else {
          const errText =
            ('errors' in message && message.errors?.join('; ')) || message.subtype
          params.onEvent({ type: 'error', message: errText })
        }
      }
    }
  } catch (err) {
    if (err instanceof AskUserPause) {
      askUser = err.payload
      params.onEvent({ type: 'ask_user', ...err.payload })
    } else if ((err as Error).name === 'AbortError') {
      params.onEvent({ type: 'error', message: 'Agent run cancelled.' })
    } else {
      const msg = err instanceof Error ? err.message : String(err)
      params.onEvent({ type: 'error', message: msg })
      throw err
    }
  }

  const success = session.finished && !askUser
  const result: DeckAgentSessionResult = {
    success,
    summary: session.summary || (success ? 'Done.' : 'Agent paused.'),
    slides: session.slides,
    changes: session.pendingChanges,
    sessionId,
    askUser,
    costUsd,
    numTurns,
    totalTokens,
  }

  params.onEvent({
    type: 'result',
    success,
    summary: result.summary,
    slides: result.slides,
    changes: result.changes,
    sessionId,
    costUsd,
    numTurns,
  })

  return result
}
