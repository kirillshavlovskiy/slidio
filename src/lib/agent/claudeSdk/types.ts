import type { Change, ClarificationQuestion, SlideData } from '@/lib/types'

export type DeckAgentStepKind =
  | 'note'
  | 'thinking'
  | 'read'
  | 'apply'
  | 'render'
  | 'done'
  | 'error'

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
