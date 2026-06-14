import { SlideData, SlideElement } from './types'

/**
 * Geometry/layout review for slide elements.
 *
 * Used to verify that an AI edit (add / update / delete) keeps the slide tidy:
 * elements stay inside the slide bounds and don't significantly overlap in ways
 * that hide content (opaque shapes painted over other elements, or text on text).
 *
 * Units are PPTX inches; the slide is 10 × 7.5 in.
 */

export const SLIDE_W_IN = 10
export const SLIDE_H_IN = 7.5

// Fraction of the smaller element's area that must be covered to count as a
// meaningful overlap (so tiny touches are ignored).
const OVERLAP_THRESHOLD = 0.5
// Tolerance (inches) for out-of-bounds so borderline rounding doesn't trip it.
const BOUNDS_TOL = 0.06

export interface LayoutIssue {
  kind: 'overlap' | 'out-of-bounds'
  elementIds: string[]
  message: string
}

function isOpaqueContainer(el: SlideElement): boolean {
  // rect/chip are opaque fills that can hide whatever is behind them. Bars are
  // thin accent lines and are treated as non-hiding.
  return el.type === 'rect' || el.type === 'chip'
}

function intersectionRatio(a: SlideElement, b: SlideElement): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  const inter = ix * iy
  if (inter <= 0) return 0
  const minArea = Math.max(0.0001, Math.min(a.w * a.h, b.w * b.h))
  return inter / minArea
}

/** Stable signature so issues can be compared across before/after states. */
export function issueSignature(issue: LayoutIssue): string {
  return `${issue.kind}:${[...issue.elementIds].sort().join('+')}`
}

export function findLayoutIssues(slide: SlideData): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  const els = slide.elements

  for (const el of els) {
    if (
      el.x < -BOUNDS_TOL ||
      el.y < -BOUNDS_TOL ||
      el.x + el.w > SLIDE_W_IN + BOUNDS_TOL ||
      el.y + el.h > SLIDE_H_IN + BOUNDS_TOL
    ) {
      issues.push({
        kind: 'out-of-bounds',
        elementIds: [el.id],
        message: `${el.id} (${el.type}) extends outside the slide [x ${el.x.toFixed(2)} y ${el.y.toFixed(
          2
        )} w ${el.w.toFixed(2)} h ${el.h.toFixed(2)}]`,
      })
    }
  }

  // Array order = paint order; later elements render on top of earlier ones.
  for (let i = 0; i < els.length; i++) {
    for (let j = i + 1; j < els.length; j++) {
      const lower = els[i]
      const upper = els[j]
      const ratio = intersectionRatio(lower, upper)
      if (ratio < OVERLAP_THRESHOLD) continue

      const bothText = lower.type === 'text' && upper.type === 'text'
      // The upper (later-painted) element hides the lower one when it's an opaque
      // container sitting on top of any non-bar element.
      const upperHidesLower = isOpaqueContainer(upper) && upper.type !== 'bar' && lower.type !== 'bar'

      if (!bothText && !upperHidesLower) continue

      const pct = Math.round(ratio * 100)
      issues.push({
        kind: 'overlap',
        elementIds: [lower.id, upper.id],
        message: bothText
          ? `text blocks ${lower.id} and ${upper.id} overlap by ${pct}% (text hidden)`
          : `${upper.id} (${upper.type}) is painted over ${lower.id} (${lower.type}) and hides it by ${pct}%`,
      })
    }
  }

  return issues
}

export interface LayoutReview {
  /** All issues present after the change. */
  issues: LayoutIssue[]
  /** Issues that did NOT exist before the change (introduced by the edit). */
  newIssues: LayoutIssue[]
}

/**
 * Compare layout issues before vs. after applying changes, per slide, and return
 * only the problems the edit introduced (so we don't try to "fix" intentional
 * pre-existing overlaps).
 */
export function reviewLayoutChange(before: SlideData[], after: SlideData[]): LayoutReview {
  const beforeSigs = new Set<string>()
  for (const slide of before) {
    for (const issue of findLayoutIssues(slide)) beforeSigs.add(issueSignature(issue))
  }

  const issues: LayoutIssue[] = []
  const newIssues: LayoutIssue[] = []
  for (const slide of after) {
    for (const issue of findLayoutIssues(slide)) {
      issues.push(issue)
      if (!beforeSigs.has(issueSignature(issue))) newIssues.push(issue)
    }
  }

  return { issues, newIssues }
}

export function formatLayoutIssues(issues: LayoutIssue[]): string {
  if (issues.length === 0) return 'no layout issues'
  return issues.map(i => `  - [${i.kind}] ${i.message}`).join('\n')
}
