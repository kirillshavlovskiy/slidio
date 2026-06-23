import type { ClarificationQuestion } from '@/lib/types'
import type { DeckPlan } from './types'

export class PlannerSession {
  plan?: DeckPlan
  finished = false
  pendingAskUser?: { intro?: string; questions: ClarificationQuestion[] }
  private _knowledgeContext: string
  private _currentDeckSummary: string
  private _hasCustomDesignSystem: boolean

  constructor(knowledgeContext: string, currentDeckSummary: string, hasCustomDesignSystem = false) {
    this._knowledgeContext = knowledgeContext
    this._currentDeckSummary = currentDeckSummary
    this._hasCustomDesignSystem = hasCustomDesignSystem
  }

  readContext(): string {
    const parts: string[] = []
    if (this._currentDeckSummary) parts.push(`CURRENT DECK:\n${this._currentDeckSummary}`)
    if (this._knowledgeContext) parts.push(`KNOWLEDGE CONTEXT:\n${this._knowledgeContext}`)
    parts.push(
      this._hasCustomDesignSystem
        ? `DESIGN SYSTEM: custom design system is loaded — use it; do NOT ask the user to choose a preset.`
        : `DESIGN SYSTEM: no custom design system uploaded — ask the user to choose a preset in ask_user (id "design_system").`
    )
    return parts.join('\n\n') || 'No existing deck or knowledge context.'
  }

  submitPlan(plan: DeckPlan): string {
    this.plan = plan
    this.finished = true
    return `Plan submitted: "${plan.title}" — ${plan.slides.length} slides, scope: ${plan.scope}.`
  }

  askUser(intro: string | undefined, questions: ClarificationQuestion[]): string {
    this.pendingAskUser = { intro, questions }
    this.finished = true
    return 'Paused for user input.'
  }
}
