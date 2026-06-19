import { SlideData, SlideElement } from './types'

/**
 * Geometry/layout review for slide elements.
 *
 * Used to verify that an AI edit (add / update / delete) keeps the slide tidy:
 * elements stay inside the slide bounds and don't significantly overlap in ways
 * that hide content (opaque shapes, text-on-text, icon/image over text, etc.).
 *
 * Units are PPTX inches; the slide is 10 × 7.5 in.
 */

export const SLIDE_W_IN = 10
export const SLIDE_H_IN = 7.5

// Fraction of the smaller element's area that must be covered to count as a
// meaningful overlap (so tiny touches are ignored).
const OVERLAP_THRESHOLD = 0.5
/** Icon/image vs text — even a sliver of overlap reads as a collision. */
const ICON_TEXT_OVERLAP_THRESHOLD = 0.06
// Tolerance (inches) for out-of-bounds so borderline rounding doesn't trip it.
const BOUNDS_TOL = 0.06

export interface LayoutIssue {
  kind:
    | 'overlap'
    | 'out-of-bounds'
    | 'margin-imbalance'
    | 'uneven-spacing'
    | 'underfill'
    | 'text-underfill'
  elementIds: string[]
  message: string
  slideId?: string
}

/** Minimum edge inset before we expect top/bottom (or left/right) margins to match. */
const EDGE_IMBALANCE_TOL = 0.15
/** Gaps between stacked elements may differ by at most this much (inches). */
const GAP_EVENNESS_TOL = 0.12
/** Need at least this many elements in a column/row to judge gap evenness. */
const MIN_FOR_GAP_CHECK = 3
/** Row/column grouping tolerance (inches). */
const ROW_COL_TOL = 0.18
/** Text that uses less than this fraction of its box height is underfilled. */
const TEXT_FILL_RATIO_MIN = 0.62
/** Minimum inner vertical dead space (inches) before flagging text underfill. */
const TEXT_INNER_GAP_MIN = 0.1
const PT_PER_IN = 72
const DEFAULT_PAD_IN = 6 / 96

function isTextElement(el: SlideElement): boolean {
  return el.type === 'text' || el.type === 'chip'
}

/**
 * Rough height (inches) of rendered text inside a text/chip box — used to detect
 * table cells where row geometry was stretched but fontSize was left too small.
 */
export function estimateTextBlockHeightIn(el: SlideElement): number {
  const s = el.style || {}
  const fontSize = s.fontSize || 12
  const lineHeight = s.lineHeight ?? 1.25
  const padT = s.padTop ?? DEFAULT_PAD_IN
  const padB = s.padBottom ?? DEFAULT_PAD_IN
  const padL = s.padLeft ?? DEFAULT_PAD_IN
  const padR = s.padRight ?? DEFAULT_PAD_IN
  const content = (el.content || '').trim()
  if (!content) return padT + padB

  const lines = content.split('\n')
  const charWidthPt = fontSize * 0.55
  const usableWIn = Math.max(0.08, el.w - padL - padR)
  const charsPerLine = Math.max(4, Math.floor((usableWIn * PT_PER_IN) / charWidthPt))

  let lineCount = 0
  for (const raw of lines) {
    const t = raw.trim()
    if (!t) {
      lineCount += 1
      continue
    }
    lineCount += Math.max(1, Math.ceil(t.length / charsPerLine))
  }

  const lineHIn = (fontSize * lineHeight) / PT_PER_IN
  return padT + padB + lineCount * lineHIn
}

function suggestFontSizeForCell(el: SlideElement): number {
  const s = el.style || {}
  const fontSize = s.fontSize || 12
  const padT = s.padTop ?? DEFAULT_PAD_IN
  const padB = s.padBottom ?? DEFAULT_PAD_IN
  const contentH = estimateTextBlockHeightIn(el) - padT - padB
  if (contentH <= 0) return fontSize
  const targetTextH = Math.max(0.08, el.h * 0.82 - padT - padB)
  return Math.min(48, Math.max(fontSize + 1, Math.round(fontSize * (targetTextH / contentH))))
}

function findTextFillIssues(slide: SlideData): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  const textEls = slide.elements.filter(isTextElement).filter(e => (e.content || '').trim())

  for (const el of textEls) {
    if (el.h < 0.28) continue
    const contentH = estimateTextBlockHeightIn(el)
    const innerGap = el.h - contentH
    const fillRatio = contentH / el.h
    if (innerGap < TEXT_INNER_GAP_MIN || fillRatio >= TEXT_FILL_RATIO_MIN) continue

    const fontSize = el.style?.fontSize || 12
    const suggested = suggestFontSizeForCell(el)
    issues.push({
      kind: 'text-underfill',
      elementIds: [el.id],
      slideId: slide.id,
      message:
        `${el.id} text fills only ~${Math.round(fillRatio * 100)}% of its cell ` +
        `(box h ${el.h.toFixed(2)}in, text ≈${contentH.toFixed(2)}in at ${fontSize}pt) — ` +
        `increase style.fontSize (try ~${suggested}pt) and/or lineHeight so copy fills the cell interior evenly`,
    })
  }

  // Table rows: if several cells in one row all underfill, surface one grouped hint.
  for (const row of groupRows(textEls)) {
    if (row.length < 2) continue
    const underfilled = row.filter(el => {
      const contentH = estimateTextBlockHeightIn(el)
      return el.h - contentH >= TEXT_INNER_GAP_MIN && contentH / el.h < TEXT_FILL_RATIO_MIN
    })
    if (underfilled.length < 2) continue
    const rowY = row[0].y
    const rowH = row[0].h
    issues.push({
      kind: 'text-underfill',
      elementIds: underfilled.map(e => e.id),
      slideId: slide.id,
      message:
        `table row at y≈${rowY.toFixed(2)}in (h ${rowH.toFixed(2)}in): ${underfilled.length} cells have small ` +
        `text with dead space inside — bump fontSize uniformly across the row (or whole table) so labels fill each cell`,
    })
  }

  return issues
}

function isLayoutElement(el: SlideElement): boolean {
  if (el.type === 'bar') return false
  // Full-bleed background bands are decorative, not content for margin math.
  if (el.type === 'rect' && el.w >= SLIDE_W_IN - 0.2 && el.h >= SLIDE_H_IN - 0.2) return false
  // Full-width top accent strip (y≈0) — intentional; do not use for margin balance.
  if (el.type === 'rect' && el.y <= 0.02 && el.h <= 0.12 && el.w >= SLIDE_W_IN - 0.25) {
    return false
  }
  return true
}

function contentBounds(els: SlideElement[]): { x: number; y: number; w: number; h: number } | null {
  const layout = els.filter(isLayoutElement)
  if (!layout.length) return null
  const x1 = Math.min(...layout.map(e => e.x))
  const y1 = Math.min(...layout.map(e => e.y))
  const x2 = Math.max(...layout.map(e => e.x + e.w))
  const y2 = Math.max(...layout.map(e => e.y + e.h))
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

function horizontalOverlap(a: SlideElement, b: SlideElement): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  return ix / Math.max(0.01, Math.min(a.w, b.w))
}

function groupColumns(els: SlideElement[]): SlideElement[][] {
  const sorted = [...els].sort((a, b) => a.x - b.x)
  const groups: SlideElement[][] = []
  for (const el of sorted) {
    let placed = false
    for (const g of groups) {
      if (g.some(other => horizontalOverlap(el, other) >= 0.35)) {
        g.push(el)
        placed = true
        break
      }
    }
    if (!placed) groups.push([el])
  }
  return groups
}

function groupRows(els: SlideElement[]): SlideElement[][] {
  const sorted = [...els].sort((a, b) => a.y - b.y)
  const groups: SlideElement[][] = []
  for (const el of sorted) {
    const cy = el.y + el.h / 2
    let placed = false
    for (const g of groups) {
      const gcy = g.reduce((s, e) => s + e.y + e.h / 2, 0) / g.length
      if (Math.abs(cy - gcy) <= ROW_COL_TOL) {
        g.push(el)
        placed = true
        break
      }
    }
    if (!placed) groups.push([el])
  }
  return groups
}

function findSpacingAndFillIssues(slide: SlideData): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  const layout = slide.elements.filter(isLayoutElement)
  if (layout.length < 2) return issues

  const bounds = contentBounds(slide.elements)
  if (!bounds) return issues

  const topM = bounds.y
  const bottomM = SLIDE_H_IN - (bounds.y + bounds.h)
  const leftM = bounds.x
  const rightM = SLIDE_W_IN - (bounds.x + bounds.w)

  if (
    (topM >= 0.12 || bottomM >= 0.12) &&
    Math.abs(topM - bottomM) > EDGE_IMBALANCE_TOL
  ) {
    issues.push({
      kind: 'margin-imbalance',
      elementIds: layout.map(e => e.id),
      slideId: slide.id,
      message:
        `vertical edge margins uneven: top ${topM.toFixed(2)}in vs bottom ${bottomM.toFixed(2)}in ` +
        `(content block should be vertically centered or have equal top/bottom inset)`,
    })
  }

  if (
    (leftM >= 0.12 || rightM >= 0.12) &&
    Math.abs(leftM - rightM) > EDGE_IMBALANCE_TOL
  ) {
    issues.push({
      kind: 'margin-imbalance',
      elementIds: layout.map(e => e.id),
      slideId: slide.id,
      message:
        `horizontal edge margins uneven: left ${leftM.toFixed(2)}in vs right ${rightM.toFixed(2)}in ` +
        `(content should have equal left/right inset or stretch to fill width evenly)`,
    })
  }

  if (
    bounds.h < SLIDE_H_IN * 0.55 &&
    bottomM > 0.55 &&
    topM < 0.4 &&
    layout.length >= MIN_FOR_GAP_CHECK
  ) {
    issues.push({
      kind: 'underfill',
      elementIds: layout.map(e => e.id),
      slideId: slide.id,
      message:
        `content hugging top (${topM.toFixed(2)}in top margin, ${bottomM.toFixed(2)}in dead space below) — ` +
        `distribute vertically with even gaps and balanced top/bottom margins`,
    })
  }

  if (
    bounds.w < SLIDE_W_IN * 0.55 &&
    rightM > 0.55 &&
    leftM < 0.4 &&
    layout.length >= MIN_FOR_GAP_CHECK
  ) {
    issues.push({
      kind: 'underfill',
      elementIds: layout.map(e => e.id),
      slideId: slide.id,
      message:
        `content hugging left (${leftM.toFixed(2)}in left margin, ${rightM.toFixed(2)}in dead space right) — ` +
        `stretch or redistribute horizontally with even column gaps and balanced side margins`,
    })
  }

  for (const col of groupColumns(layout)) {
    if (col.length < MIN_FOR_GAP_CHECK) continue
    const sorted = [...col].sort((a, b) => a.y - b.y)
    const gaps: number[] = []
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].y - (sorted[i].y + sorted[i].h)
      if (gap >= 0) gaps.push(gap)
    }
    if (gaps.length >= 2 && Math.max(...gaps) - Math.min(...gaps) > GAP_EVENNESS_TOL) {
      issues.push({
        kind: 'uneven-spacing',
        elementIds: sorted.map(e => e.id),
        slideId: slide.id,
        message:
          `uneven vertical gaps in column (${gaps.map(g => g.toFixed(2)).join(', ')}in) — ` +
          `use equal spacing between stacked elements`,
      })
    }
  }

  for (const row of groupRows(layout)) {
    if (row.length < MIN_FOR_GAP_CHECK) continue
    const sorted = [...row].sort((a, b) => a.x - b.x)
    const gaps: number[] = []
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].x - (sorted[i].x + sorted[i].w)
      if (gap >= 0) gaps.push(gap)
    }
    if (gaps.length >= 2 && Math.max(...gaps) - Math.min(...gaps) > GAP_EVENNESS_TOL) {
      issues.push({
        kind: 'uneven-spacing',
        elementIds: sorted.map(e => e.id),
        slideId: slide.id,
        message:
          `uneven horizontal gaps in row (${gaps.map(g => g.toFixed(2)).join(', ')}in) — ` +
          `use equal spacing between columns or stretch items to fill width`,
      })
    }
  }

  return [...issues, ...findTextFillIssues(slide)]
}

function isOpaqueContainer(el: SlideElement): boolean {
  // rect/chip are opaque fills that can hide whatever is behind them. Bars are
  // thin accent lines and are treated as non-hiding.
  return el.type === 'rect' || el.type === 'chip'
}

function isTextLike(el: SlideElement): boolean {
  return el.type === 'text' || el.type === 'chip'
}

function isIconOrImage(el: SlideElement): boolean {
  return el.type === 'icon' || el.type === 'image'
}

function overlapThresholdForPair(a: SlideElement, b: SlideElement): number {
  if (
    (isIconOrImage(a) && isTextLike(b)) ||
    (isIconOrImage(b) && isTextLike(a))
  ) {
    return ICON_TEXT_OVERLAP_THRESHOLD
  }
  return OVERLAP_THRESHOLD
}

function isContentHidingOverlap(
  lower: SlideElement,
  upper: SlideElement,
  ratio: number
): boolean {
  const threshold = overlapThresholdForPair(lower, upper)
  if (ratio < threshold) return false

  if (isTextLike(lower) && isTextLike(upper)) return true
  if (isOpaqueContainer(upper) && upper.type !== 'bar' && lower.type !== 'bar') return true
  if (
    (isIconOrImage(lower) && isTextLike(upper)) ||
    (isIconOrImage(upper) && isTextLike(lower))
  ) {
    return true
  }
  return false
}

function formatOverlapMessage(
  lower: SlideElement,
  upper: SlideElement,
  pct: number
): string {
  const iconText =
    (isIconOrImage(lower) && isTextLike(upper)) ||
    (isIconOrImage(upper) && isTextLike(lower))
  if (iconText) {
    const icon = isIconOrImage(lower) ? lower : upper
    const text = isTextLike(lower) ? lower : upper
    return (
      `icon ${icon.id} overlaps text ${text.id} by ${pct}% — place the icon LEFT of the text ` +
      `with ~0.12–0.18in gap (or nudge text x right + style.padLeft); never let the boxes intersect`
    )
  }
  if (isTextLike(lower) && isTextLike(upper)) {
    return `text blocks ${lower.id} and ${upper.id} overlap by ${pct}% (text hidden)`
  }
  return `${upper.id} (${upper.type}) is painted over ${lower.id} (${lower.type}) and hides it by ${pct}%`
}

function intersectionRatio(a: SlideElement, b: SlideElement): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  const inter = ix * iy
  if (inter <= 0) return 0
  const minArea = Math.max(0.0001, Math.min(a.w * a.h, b.w * b.h))
  return inter / minArea
}

/** Issues that geometry-only layout fixes should act on (overlaps + overflow). */
export const GEOMETRY_LAYOUT_KINDS = new Set<LayoutIssue['kind']>(['overlap', 'out-of-bounds'])

export function isGeometryLayoutIssue(issue: LayoutIssue): boolean {
  return GEOMETRY_LAYOUT_KINDS.has(issue.kind)
}

export function filterGeometryLayoutIssues(issues: LayoutIssue[]): LayoutIssue[] {
  return issues.filter(isGeometryLayoutIssue)
}

/** Overlap + out-of-bounds only — skip margin/spacing noise during styling-only passes. */
export function filterOverlapOnlyLayoutIssues(issues: LayoutIssue[]): LayoutIssue[] {
  return issues.filter(i => i.kind === 'overlap' || i.kind === 'out-of-bounds')
}

/** Overlap + out-of-bounds only — for quick-action geometry passes. */
export function findGeometryIssues(slide: SlideData): LayoutIssue[] {
  return filterGeometryLayoutIssues(findLayoutIssues(slide))
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
        slideId: slide.id,
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
      if (!isContentHidingOverlap(lower, upper, ratio)) continue

      const pct = Math.round(ratio * 100)
      issues.push({
        kind: 'overlap',
        elementIds: [lower.id, upper.id],
        slideId: slide.id,
        message: formatOverlapMessage(lower, upper, pct),
      })
    }
  }

  return [...issues, ...findSpacingAndFillIssues(slide)]
}

/** Spacing, margin-balance, and fill issues only (for review-phase checks). */
export function findSpacingIssues(slide: SlideData): LayoutIssue[] {
  return findSpacingAndFillIssues(slide)
}

/** Overlap issues on a slide (text-on-text, icon/image-on-text, opaque-on-content). */
export function findOverlapIssues(slide: SlideData): LayoutIssue[] {
  return findLayoutIssues(slide).filter(i => i.kind === 'overlap')
}

/** Overlaps where every involved element is in elementIds (e.g. user multi-selection). */
export function findOverlapsAmong(elementIds: string[], slide: SlideData): LayoutIssue[] {
  const idSet = new Set(elementIds)
  return findOverlapIssues(slide).filter(i => i.elementIds.every(id => idSet.has(id)))
}

export interface LayoutReview {
  /** All issues present after the change. */
  issues: LayoutIssue[]
  /** Issues that did NOT exist before the change (introduced by the edit). */
  newIssues: LayoutIssue[]
  /** Spacing/fill/margin issues on slides after the change (always reported). */
  spacingIssues: LayoutIssue[]
  /** Overlap issues on slides after the change (always reported in review/audit). */
  overlapIssues: LayoutIssue[]
}

/**
 * Compare layout issues before vs. after applying changes, per slide, and return
 * only the problems the edit introduced (so we don't try to "fix" intentional
 * pre-existing overlaps). Spacing/fill issues are always listed for after slides.
 */
export function reviewLayoutChange(before: SlideData[], after: SlideData[]): LayoutReview {
  const beforeSigs = new Set<string>()
  for (const slide of before) {
    for (const issue of findLayoutIssues(slide)) beforeSigs.add(issueSignature(issue))
  }

  const issues: LayoutIssue[] = []
  const newIssues: LayoutIssue[] = []
  const spacingIssues: LayoutIssue[] = []
  const overlapIssues: LayoutIssue[] = []
  const spacingKinds = new Set<LayoutIssue['kind']>([
    'margin-imbalance',
    'uneven-spacing',
    'underfill',
    'text-underfill',
  ])

  for (const slide of after) {
    for (const issue of findLayoutIssues(slide)) {
      issues.push(issue)
      if (!beforeSigs.has(issueSignature(issue))) newIssues.push(issue)
      if (spacingKinds.has(issue.kind)) spacingIssues.push(issue)
      if (issue.kind === 'overlap') overlapIssues.push(issue)
    }
  }

  return { issues, newIssues, spacingIssues, overlapIssues }
}

export function formatLayoutIssues(issues: LayoutIssue[]): string {
  if (issues.length === 0) return 'no layout issues'
  return issues.map(i => `  - [${i.kind}] ${i.message}`).join('\n')
}

/** Tool-result block for overlap checks (review phase + layout audits). */
export function formatOverlapCheck(issues: LayoutIssue[]): string {
  if (issues.length === 0) {
    return 'OVERLAP CHECK — no content-hiding overlaps detected.'
  }
  return (
    `OVERLAP CHECK — fix before finish:\n${formatLayoutIssues(issues)}\n` +
    `Separate colliding elements: for icon + text pairs, move the icon to the LEFT with a clear gap ` +
    `and shift text right (or add style.padLeft) so boxes do not intersect.`
  )
}

/** Tool-result block for spacing/fill checks (review phase + layout audits). */
export function formatSpacingCheck(issues: LayoutIssue[]): string {
  if (issues.length === 0) {
    return 'SPACING / FILL CHECK — margins and gaps look balanced.'
  }
  return (
    `SPACING / FILL CHECK — fix before finish:\n${formatLayoutIssues(issues)}\n` +
    `Rebalance: equal top/bottom and left/right margins; even gaps between stacked elements; ` +
    `stretch or redistribute columns/rows to fill the slide width/height without dead zones. ` +
    `For tables: after row/cell geometry is even, increase style.fontSize on cell text so copy fills ` +
    `each cell interior (not just the outer box).`
  )
}
