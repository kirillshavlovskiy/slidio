/**
 * Model selection for the agentic pipeline.
 *
 * Effort tiers:
 *   low / medium  → Haiku 4.5  (layout fixes, icon adds, recolors, simple edits)
 *   high / xhigh  → Sonnet 4.6 (deck builds, complex multi-slide restructures)
 *   max           → Sonnet 4.6
 *
 * Override both via env vars:
 *   ANTHROPIC_MODEL       → forces ALL tiers to this model
 *   ANTHROPIC_MODEL_HEAVY → overrides the high/xhigh/max tier only
 */

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type AgentProvider = 'openai' | 'anthropic' | 'claude-agent-sdk'
export type AgentPhase = 'execute' | 'review'

const MODEL_LIGHT = 'claude-haiku-4-5-20251001'
const MODEL_HEAVY = 'claude-sonnet-4-6'

export function getAgentProvider(): AgentProvider {
  return 'claude-agent-sdk'
}

/** Model for low/medium effort — cheap, fast, good enough for structured JSON edits. */
export function agentModelLight(): string {
  return process.env.ANTHROPIC_MODEL || MODEL_LIGHT
}

/** Model for high/xhigh/max effort — full Sonnet for deck builds and complex edits. */
export function agentModelHeavy(): string {
  return process.env.ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL_HEAVY || MODEL_HEAVY
}

/** Pick model based on effort level. */
export function agentModel(effort?: Effort): string {
  if (process.env.ANTHROPIC_MODEL) return process.env.ANTHROPIC_MODEL
  switch (effort) {
    case 'high':
    case 'xhigh':
    case 'max':
      return MODEL_HEAVY
    default:
      return MODEL_LIGHT
  }
}

export const PLANNING_MODEL = agentModelHeavy()
export const REVIEW_MODEL = agentModelLight()

export function modelForAgentPhase(phase: AgentPhase): string {
  return phase === 'review' ? agentModelLight() : agentModelHeavy()
}

export function modelForEffort(effort: Effort): string {
  return agentModel(effort)
}

export function modelForLayoutReview(): string {
  return agentModelLight()
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
  if (!effort) return 'medium'
  return effort
}
