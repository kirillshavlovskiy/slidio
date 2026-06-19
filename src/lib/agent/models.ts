/**
 * Central model routing for agentic edit pipelines.
 *
 * Execute phase (planning, reading slides, content edits, small changes):
 *   Haiku 4.5 — fast and cheap.
 *
 * Review phase (layout/design verification and fixes after the first apply):
 *   Sonnet 4.6 — stronger visual/layout reasoning.
 */

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const PLANNING_MODEL =
  process.env.ANTHROPIC_CHEAP_MODEL || 'claude-haiku-4-5'

export const REVIEW_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'

/** Agent loop phase — client sets `review` after the first apply_changes in a run. */
export type AgentPhase = 'execute' | 'review'

export function modelForAgentPhase(phase: AgentPhase): string {
  return phase === 'review' ? REVIEW_MODEL : PLANNING_MODEL
}

/** Single-shot / router: low–medium → Haiku; high+ → Sonnet for heavy one-shot work. */
export function modelForEffort(effort: Effort): string {
  return effort === 'low' || effort === 'medium' ? PLANNING_MODEL : REVIEW_MODEL
}

/** Layout/design self-review pass always runs on Sonnet (post-initial patch). */
export function modelForLayoutReview(): string {
  return REVIEW_MODEL
}
