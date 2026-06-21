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
    }
  | { type: 'ask_user'; intro?: string; questions: ClarificationQuestion[] }
  | { type: 'error'; message: string }
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
