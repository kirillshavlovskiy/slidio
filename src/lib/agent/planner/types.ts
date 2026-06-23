import type { PresentationScopeId } from '@/lib/presentationScope'
import type { ClarificationQuestion } from '@/lib/types'

export type SlideLayout =
  | 'cover'
  | 'section-header'
  | 'bullets'
  | 'two-column'
  | 'chart'
  | 'image-text'
  | 'quote'
  | 'timeline'
  | 'grid'
  | 'closing'

export type PlanSlide = {
  index: number           // 1-based deck position
  title: string           // slide headline
  purpose: string         // e.g. "Establish the problem", "Introduce solution"
  layout: SlideLayout
  contentBrief: string    // 1–3 sentences: what the content agent must put on this slide
  dataPoints?: string[]   // specific metrics/facts to source from knowledge context
  visualHint?: string     // optional design note ("use a bar chart", "logo wall")
}

export type DeckTone = 'executive' | 'technical' | 'investor' | 'educational' | 'persuasive'

/** Consistent title/header style to apply on every slide in the deck. */
export type TitleTypography = {
  fontFace: string          // e.g. "Inter", "Calibri", "Bagoss"
  fontSize: number          // pt, e.g. 28
  color: string             // hex no #, e.g. "FFFFFF"
  bold: boolean
  align: 'left' | 'center' | 'right'
}

export type DeckPlan = {
  scope: PresentationScopeId
  audience: string
  tone: DeckTone
  title: string           // proposed deck title
  oneLiner: string        // the full story in one sentence
  slides: PlanSlide[]
  knowledgeGaps?: string[] // data the planner couldn't find — user should provide before build
  /** Unified title/header style for every slide — derived from design system or sensible default. */
  typography?: TitleTypography
  /** Design system preset chosen by user during planning (only when no custom DS was uploaded). */
  designSystemPreset?: 'general-light' | 'general-dark' | 'warm-beige'
}

// Events streamed from the planner agent to the client.
export type PlannerStreamEvent =
  | { type: 'step'; kind: 'thinking' | 'note' | 'reading' | 'done'; label: string }
  | { type: 'ask_user'; intro?: string; questions: ClarificationQuestion[] }
  | { type: 'plan_ready'; plan: DeckPlan }
  | { type: 'session_init'; sessionId: string }
  | { type: 'error'; message: string }

export type PlannerSessionResult = {
  plan?: DeckPlan
  askUser?: { intro?: string; questions: ClarificationQuestion[] }
  sessionId?: string
}

// Phase header event — shared across all multi-agent phases (plan / content / layout).
// Added to the SDK stream so the chat can render phase separators.
export type AgentPhaseEvent = {
  type: 'phase_start'
  phase: 'plan' | 'content' | 'layout'
  label: string
}
