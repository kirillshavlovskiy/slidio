import type { Change, SlideData } from '@/lib/types'
import { changesAreGeometryOnly } from '@/lib/preview'
import type { SemanticEditPlan, ValidationIssue, ValidationResult } from './types'

export type ReviewInput = {
  instruction: string
  semanticEditPlan: SemanticEditPlan | null
  changes: Change[]
  slidesAfter: SlideData[]
  approvalRequired?: boolean
}

function textFromChanges(changes: Change[], slides: SlideData[]): string {
  const parts: string[] = []
  for (const c of changes) {
    if (c.op === 'delete') continue
    if (c.patch?.content) parts.push(String(c.patch.content))
    if (c.element?.content) parts.push(String(c.element.content))
    if (c.patch?.chart?.title) parts.push(String(c.patch.chart.title))
    if (c.element?.chart?.title) parts.push(String(c.element.chart.title))
  }
  for (const s of slides) {
    for (const el of s.elements) {
      if (el.content) parts.push(el.content)
      if (el.chart?.title) parts.push(el.chart.title)
    }
  }
  return parts.join('\n').toLowerCase()
}

function countBulletsOnSlide(slide: SlideData): number {
  let n = 0
  for (const el of slide.elements) {
    if (el.type !== 'text' && el.type !== 'chip') continue
    const lines = (el.content || '').split('\n').filter(l => l.trim())
    n += lines.length
  }
  return n
}

/** Rule-based knowledge validation (Phase 3 — no extra LLM call). */
export function validateKnowledgeEdit(input: ReviewInput): ValidationResult {
  const issues: ValidationIssue[] = []
  const combinedText = textFromChanges(input.changes, input.slidesAfter)
  const plan = input.semanticEditPlan
  const investorFacing =
    input.approvalRequired ||
    /\b(investor|pitch|fundraising|board|lp|external|due diligence)\b/i.test(input.instruction)
  const candidateClaimsApproved =
    /\b(legal review|unverified).*(pending|footnote)/i.test(input.instruction) ||
    /\buse\b.*\bcandidate\b/i.test(input.instruction) ||
    /\bcandidate\b.*\b(footnote|\*|asterisk|mark)/i.test(input.instruction)

  if (plan) {
    // Pure geometry/style edits (move, resize, recolor, delete decorative shapes) never
    // change slide copy — skip claim scanning entirely.
    if (changesAreGeometryOnly(input.changes)) {
      return {
        validation_result: 'pass',
        scores: {
          factual_accuracy: 0.95,
          layout_quality: 0.9,
          brand_compliance: 0.9,
          narrative_consistency: 0.9,
          cognitive_load: 0.9,
        },
        issues: [],
        recommended_action: 'commit',
      }
    }

    for (const claim of plan.claims_to_use) {
      const nameHit = combinedText.includes(claim.name.toLowerCase().slice(0, 40))
      if (claim.status === 'candidate' && (nameHit || investorFacing)) {
        if (candidateClaimsApproved && combinedText.includes('*')) continue
        issues.push({
          type: 'unapproved_claim',
          severity: investorFacing ? 'high' : 'medium',
          message: `Claim "${claim.name}" is candidate (unverified) — ${investorFacing ? 'not suitable for investor-facing copy without approval' : 'mark as draft or verify'}`,
          node_id: claim.id,
        })
      }
      if (nameHit && !claim.evidence?.trim()) {
        issues.push({
          type: 'missing_evidence',
          severity: 'medium',
          message: `Claim "${claim.name}" is used but has no evidence snippet in the knowledge graph`,
          node_id: claim.id,
        })
      }
    }

    for (const flag of plan.risk_flags) {
      if (/candidate/i.test(flag) && investorFacing) {
        issues.push({
          type: 'unapproved_claim',
          severity: 'high',
          message: flag,
        })
      }
    }
  }

  const changedSlideIds = Array.from(new Set(input.changes.map(c => c.slideId)))
  for (const slideId of changedSlideIds) {
    const slide = input.slidesAfter.find(s => s.id === slideId)
    if (!slide) continue
    const bullets = countBulletsOnSlide(slide)
    if (bullets > 12) {
      issues.push({
        type: 'cognitive_load',
        severity: bullets > 18 ? 'high' : 'medium',
        message: `Slide ${slideId} has ${bullets} text lines — consider condensing for executive audiences`,
        slide_id: slideId,
      })
    }
  }

  const hasHigh = issues.some(i => i.severity === 'high')
  const hasMedium = issues.some(i => i.severity === 'medium')

  let validation_result: ValidationResult['validation_result'] = 'pass'
  let recommended_action: ValidationResult['recommended_action'] = 'commit'

  if (hasHigh && investorFacing) {
    validation_result = 'human_review'
    recommended_action = 'request_human_review'
  } else if (hasHigh || (hasMedium && issues.length >= 2)) {
    validation_result = 'needs_fix'
    recommended_action = 'revise_before_commit'
  } else if (hasMedium) {
    validation_result = 'needs_fix'
    recommended_action = 'revise_before_commit'
  }

  const penalty = Math.min(0.35, issues.length * 0.06)

  return {
    validation_result,
    scores: {
      factual_accuracy: Math.max(0.5, 0.95 - (hasHigh ? 0.25 : 0) - (hasMedium ? 0.08 : 0)),
      layout_quality: 0.8,
      brand_compliance: 0.85,
      narrative_consistency: Math.max(0.6, 0.88 - penalty),
      cognitive_load: Math.max(0.5, 0.85 - (issues.some(i => i.type === 'cognitive_load') ? 0.2 : 0)),
    },
    issues,
    recommended_action,
  }
}

export function formatValidationForAgent(result: ValidationResult): string {
  if (result.validation_result === 'pass') {
    return 'Knowledge validation: PASS — no blocking issues.'
  }
  const lines = [
    `Knowledge validation: ${result.validation_result.toUpperCase()} (${result.recommended_action})`,
    'Issues:',
    ...result.issues.map(i => `- [${i.severity}] ${i.type}: ${i.message}`),
    result.validation_result === 'needs_fix'
      ? 'Revise the slide copy to address high/medium issues before calling finish.'
      : 'Flag for human review — soften unverified claims or use placeholders.',
  ]
  return lines.join('\n')
}

export function formatValidationForUser(result: ValidationResult): string {
  if (!result.issues.length) return 'Knowledge check passed.'
  return result.issues
    .slice(0, 4)
    .map(i => i.message)
    .join(' · ')
}
