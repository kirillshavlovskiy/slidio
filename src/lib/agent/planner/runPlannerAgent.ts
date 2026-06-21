import { query } from '@anthropic-ai/claude-agent-sdk'
import { agentModel, coerceAgentEffort, type Effort } from '@/lib/agent/models'
import { buildPlannerSystemPrompt, buildPlannerUserPrompt } from './plannerPrompt'
import { PlannerSession } from './plannerSession'
import { createPlannerMcpServer, PLANNER_MCP_TOOL_NAMES } from './plannerMcpServer'
import type { PlannerStreamEvent, PlannerSessionResult } from './types'

type AsstMessage = { type: string; message?: { content?: unknown[] } }

function extractBlocks(message: AsstMessage, blockType: 'text' | 'thinking'): string {
  if (message.type !== 'assistant' || !Array.isArray(message.message?.content)) return ''
  return message.message.content
    .map(b => {
      if (typeof b === 'object' && b !== null && 'type' in b) {
        const block = b as { type: string; text?: string; thinking?: string }
        if (block.type === blockType) {
          return blockType === 'text' ? (block.text ?? '') : (block.thinking ?? '')
        }
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

export async function runPlannerAgent(params: {
  userInstruction: string
  knowledgeContext: string
  currentDeckSlideCount: number
  currentDeckTitles: string[]
  effort: Effort
  resume?: string
  onEvent: (event: PlannerStreamEvent) => void
  abortSignal?: AbortSignal
}): Promise<PlannerSessionResult> {
  const effort = coerceAgentEffort(params.effort)
  const currentDeckSummary =
    params.currentDeckSlideCount > 0
      ? `${params.currentDeckSlideCount} slides: ${params.currentDeckTitles.map((t, i) => `${i + 1}. ${t || '(untitled)'}`).join(', ')}`
      : 'Empty deck.'

  const session = new PlannerSession(params.knowledgeContext, currentDeckSummary)
  const abortController = new AbortController()

  if (params.abortSignal) {
    if (params.abortSignal.aborted) abortController.abort()
    else params.abortSignal.addEventListener('abort', () => abortController.abort(), { once: true })
  }

  const plannerServer = createPlannerMcpServer(session, params.onEvent, abortController)

  const systemPrompt = buildPlannerSystemPrompt({ hasKnowledge: !!params.knowledgeContext.trim() })
  const userPrompt = buildPlannerUserPrompt({
    userInstruction: params.userInstruction,
    currentDeckSlideCount: params.currentDeckSlideCount,
    currentDeckTitles: params.currentDeckTitles,
  })

  let sessionId: string | undefined
  let askUser: PlannerSessionResult['askUser']

  try {
    const q = query({
      prompt: userPrompt,
      options: {
        model: agentModel(),
        maxTurns: 6,
        effort,
        systemPrompt,
        mcpServers: { planner: plannerServer },
        strictMcpConfig: true,
        allowedTools: [...PLANNER_MCP_TOOL_NAMES],
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
          if (line.trim()) console.error('[planner-agent]', line.trim())
        },
      },
    })

    for await (const message of q) {
      if (message.type === 'system' && message.subtype === 'init') {
        sessionId = message.session_id
      }

      if (message.type === 'assistant') {
        const thinking = extractBlocks(message, 'thinking')
        if (thinking) params.onEvent({ type: 'step', kind: 'thinking', label: thinking })

        const text = extractBlocks(message, 'text')
        if (text) params.onEvent({ type: 'step', kind: 'note', label: text })
      }

      if (message.type === 'result') {
        sessionId = message.session_id
        if (message.subtype !== 'success' && !abortController.signal.aborted) {
          const errText = ('errors' in message && message.errors?.join('; ')) || message.subtype
          params.onEvent({ type: 'error', message: errText })
        }
      }
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      if (session.pendingAskUser) {
        // intentional pause — ask_user fired the abort; event already emitted by the tool handler
        askUser = session.pendingAskUser
      } else {
        // user-initiated cancel
        params.onEvent({ type: 'error', message: 'Planner cancelled.' })
      }
    } else {
      const msg = err instanceof Error ? err.message : String(err)
      params.onEvent({ type: 'error', message: msg })
      throw err
    }
  }

  return {
    plan: session.plan,
    askUser,
    sessionId,
  }
}
