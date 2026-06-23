import type { Change, ClarificationQuestion, SlideData } from '@/lib/types'
import type { DeckPlan } from '@/lib/agent/planner/types'

export type DeckAgentStepKind =
  | 'note'
  | 'thinking'
  | 'read'
  | 'apply'
  | 'render'
  | 'done'
  | 'error'

// Which multi-agent phase is currently running.
export type AgentPipelinePhase = 'plan' | 'content' | 'layout'

export type DeckAgentStreamEvent =
  | { type: 'step'; kind: DeckAgentStepKind; label: string }
  | {
      type: 'result'
      success: boolean
      summary: string
      slides: SlideData[]
      changes: Change[]
      sessionId?: string
      costUsd?: number
      numTurns?: number
      totalTokens?: number
    }
  /** Emitted after every apply_changes so the client can render slides progressively. */
  | { type: 'slides_update'; slides: SlideData[] }
  | { type: 'ask_user'; intro?: string; questions: ClarificationQuestion[] }
  | { type: 'error'; message: string }
  /** Emitted after each SDK turn with running cost totals. */
  | { type: 'turn_stats'; turn: number; totalTokens: number; costUsd: number }
  // Multi-agent pipeline events
  | { type: 'phase_start'; phase: AgentPipelinePhase; label: string }
  | { type: 'plan_ready'; plan: DeckPlan; sessionId?: string }

export type DeckAgentSessionResult = {
  success: boolean
  summary: string
  slides: SlideData[]
  changes: Change[]
  sessionId?: string
  askUser?: { intro?: string; questions: ClarificationQuestion[] }
  costUsd?: number
  numTurns?: number
  totalTokens?: number
}
