/**
 * Single model for the entire app. No cheap/haiku tier — it fails spatial edits.
 *
 * Default: gpt-4.1-mini (OpenAI) when OPENAI_API_KEY is set.
 * Fallback: claude-sonnet-4-6 (Anthropic).
 */

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type AgentProvider = 'openai' | 'anthropic' | 'claude-agent-sdk'
export type AgentPhase = 'execute' | 'review'

const HAIKU = /haiku/i

export const OPENAI_AGENT_MODEL =
  process.env.OPENAI_AGENT_MODEL || 'gpt-4.1-mini'

export const ANTHROPIC_AGENT_MODEL =
  process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'

/** Reject Haiku everywhere — no fallback, no second chance. */
export function assertAllowedModel(model: string, context = 'model'): string {
  if (HAIKU.test(model)) {
    throw new Error(
      `[models] ${context}: claude-haiku is removed from this project. Use gpt-4.1-mini or claude-sonnet-4-6.`
    )
  }
  return model
}

export function getAgentProvider(): AgentProvider {
  if (process.env.AGENT_PROVIDER === 'claude-agent-sdk') return 'claude-agent-sdk'
  if (process.env.AGENT_PROVIDER === 'anthropic') return 'anthropic'
  if (process.env.AGENT_PROVIDER === 'openai' && process.env.OPENAI_API_KEY?.trim()) {
    return 'openai'
  }
  if (process.env.OPENAI_API_KEY?.trim()) return 'openai'
  return 'anthropic'
}

/** One model for agent, router, graph extract, single-shot — everything. */
export function agentModel(): string {
  const provider = getAgentProvider()
  const model =
    provider === 'openai'
      ? process.env.OPENAI_AGENT_MODEL || OPENAI_AGENT_MODEL
      : process.env.ANTHROPIC_MODEL || ANTHROPIC_AGENT_MODEL
  return assertAllowedModel(model, 'agent')
}

export const PLANNING_MODEL = agentModel()
export const REVIEW_MODEL = agentModel()

export function modelForAgentPhase(_phase: AgentPhase): string {
  return agentModel()
}

export function modelForEffort(_effort: Effort): string {
  return agentModel()
}

export function modelForLayoutReview(): string {
  return agentModel()
}

export function agentThinkingBudget(effort: Effort): number {
  switch (effort) {
    case 'low':
      return 3000
    case 'medium':
      return 5000
    case 'high':
      return 7000
    case 'xhigh':
      return 9000
    case 'max':
    default:
      return 11000
  }
}

export function agentMaxTokens(effort: Effort): number {
  switch (effort) {
    case 'low':
      return 10000
    case 'medium':
      return 14000
    case 'high':
      return 20000
    case 'xhigh':
      return 24000
    case 'max':
    default:
      return 28000
  }
}

export function coerceAgentEffort(effort: Effort | undefined): Effort {
  if (!effort || effort === 'low') return 'medium'
  return effort
}
