import type { PresentationScopeId } from '@/lib/presentationScope'
import type { IncompleteAgentContext } from '@/lib/agent/routingHeuristics'

export const AGENT_PAUSE_STATE_VERSION = 1

export type AgentPauseReason =
  | 'apply_limit'
  | 'step_limit'
  | 'oscillation'
  | 'no_tool_call'
  | 'timeout'
  | 'spacing_limit'
  | 'overloaded'
  | 'rate_limit'

/** JSON-serializable agent turn (matches page.tsx AgentMessage). */
export type SerializedAgentMessage =
  | { role: 'assistant'; content: unknown[] }
  | { role: 'user'; content: string | unknown[] }

/**
 * Snapshot taken when the agent loop hits a guard (edit/step limit, oscillation, etc.).
 * Resume replays the exact messages[] thread and continues the for-loop — no context loss.
 */
export type AgentPauseState = {
  version: typeof AGENT_PAUSE_STATE_VERSION
  reason: AgentPauseReason
  reasonLabel: string
  originalInstruction: string
  messages: SerializedAgentMessage[]
  /** Next for-loop index (0-based) when resuming. */
  nextStep: number
  introCompressed: boolean
  presentationScope: PresentationScopeId | null
  parsedScopeForBuild: PresentationScopeId | null
  deckBuildWithScope: boolean
  layoutAuditRun: boolean
  geometryOnlyRun: boolean
  deckSlideCap: number
  agentEffort: string
  appliedAny: boolean
  verifiedSinceApply: boolean
  incompleteContext: IncompleteAgentContext
  /** How many times this run has been resumed after a pause. */
  segmentIndex: number
  pausedAt: number
}

export function buildAgentResumeNote(ps: AgentPauseState): string {
  return (
    `[PIPELINE PAUSED — resuming segment ${ps.segmentIndex + 1}. CHANGE request — NOT a question. ` +
    `Do NOT call ask_user. Do NOT restart from slide 1 or re-plan the whole deck. ` +
    `Pick up exactly where the previous segment stopped.]\n\n` +
    `Pause reason: ${ps.reasonLabel}\n` +
    `Continue the same workflow with the next appropriate tool call (get_slides, apply_changes, render_slide, or finish).`
  )
}

export function cloneMessages<T>(messages: T[]): T[] {
  return JSON.parse(JSON.stringify(messages)) as T[]
}
