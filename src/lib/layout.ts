import { SlideData, SlideElement } from './types'
import { CANVAS_FONT_SCALE, CANVAS_PX_PER_IN } from './slideDimensions'
import { effectiveLineHeight, textMetricsPaddingPx } from './textRender'

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
/** Text vs text — any box intersection hides copy; use a low threshold. */
const TEXT_TEXT_OVERLAP_THRESHOLD = 0.06
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
    | 'text-overflow'
    | 'misalignment'
  elementIds: string[]
  message: string
  slideId?: string
}

/** Left/top edges in a column/row may differ by at most this much (inches). */
const EDGE_ALIGN_TOL = 0.06
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
/** Content must exceed box height by at least this much to flag text overflow. */
const TEXT_OVERFLOW_MIN = 0.04
const PT_PER_IN = 72
/** Only count padding explicitly set on the element (PPTX boxes are already inset). */
const DEFAULT_PAD_IN = 0

function isTextElement(el: SlideElement): boolean {
  return el.type === 'text' || el.type === 'chip'
}

/**
 * Rough height (inches) of rendered text inside a text/chip box — used to detect
 * table cells where row geometry was stretched but fontSize was left too small.
 */
export function estimateTextBlockHeightIn(el: SlideElement): number {
  const s = el.style || {}
  const content = (el.content || '').trim()
  const fontSize = s.fontSize || 12
  const fontSizePx = fontSize * CANVAS_FONT_SCALE
  const metrics = textMetricsPaddingPx(fontSizePx)
  const padT = s.padTop ?? metrics.top / CANVAS_PX_PER_IN
  const padB = s.padBottom ?? metrics.bottom / CANVAS_PX_PER_IN
  const padL = s.padLeft ?? DEFAULT_PAD_IN
  const padR = s.padRight ?? DEFAULT_PAD_IN
  if (!content) return padT + padB

  const lines = content.split('\n')
  const lineHeight = effectiveLineHeight(s, lines.length)
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

  const lineHIn = (fontSize * CANVAS_FONT_SCALE * lineHeight) / PT_PER_IN
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

function suggestFontSizeForOverflow(el: SlideElement): number {
  const fontSize = el.style?.fontSize || 12
  const contentH = estimateTextBlockHeightIn(el)
  if (contentH <= el.h) return fontSize
  const targetH = el.h * 0.95
  return Math.max(6, Math.round(fontSize * (targetH / contentH)))
}

function findTextOverflowIssues(slide: SlideData): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  for (const el of slide.elements.filter(isTextElement)) {
    if (!(el.content || '').trim()) continue
    const contentH = estimateTextBlockHeightIn(el)
    const overflow = contentH - el.h
    if (overflow < TEXT_OVERFLOW_MIN) continue

    const fontSize = el.style?.fontSize || 12
    const suggested = suggestFontSizeForOverflow(el)
    issues.push({
      kind: 'text-overflow',
      elementIds: [el.id],
      slideId: slide.id,
      message:
        `${el.id} text overflows its box (≈${contentH.toFixed(2)}in tall in h ${el.h.toFixed(2)}in box at ${fontSize}pt) — ` +
        `reduce style.fontSize to ~${suggested}pt and/or increase h, lineHeight, or vertical padding so nothing clips top/bottom`,
    })
  }
  return issues
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

function findAlignmentIssues(slide: SlideData): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  const layout = slide.elements.filter(isLayoutElement)
  if (layout.length < 2) return issues

  const alignTargets = layout.filter(
    e => isTextLike(e) || isIconOrImage(e) || (e.type === 'rect' && e.w < 5.5)
  )
  if (alignTargets.length < 2) return issues

  for (const col of groupColumns(alignTargets)) {
    const textInCol = col.filter(isTextLike)
    if (textInCol.length < 2) continue
    const leftXs = textInCol.map(e => e.x)
    const leftSpread = Math.max(...leftXs) - Math.min(...leftXs)
    if (leftSpread > EDGE_ALIGN_TOL) {
      const ids = textInCol.map(e => e.id)
      issues.push({
        kind: 'misalignment',
        elementIds: ids,
        slideId: slide.id,
        message:
          `text left edges misaligned in column (${leftSpread.toFixed(2)}in spread: ${ids.join(', ')}) — ` +
          `snap text boxes to the same x (icons may stay left of labels)`,
      })
    }
  }

  for (const row of groupRows(alignTargets)) {
    if (row.length === 2 && row.some(isIconOrImage) && row.some(isTextLike)) continue
    const textInRow = row.filter(isTextLike)
    if (textInRow.length < 2) continue
    const tops = textInRow.map(e => e.y)
    const topSpread = Math.max(...tops) - Math.min(...tops)
    if (topSpread > EDGE_ALIGN_TOL) {
      const ids = textInRow.map(e => e.id)
      issues.push({
        kind: 'misalignment',
        elementIds: ids,
        slideId: slide.id,
        message:
          `text tops misaligned in row (${topSpread.toFixed(2)}in spread: ${ids.join(', ')}) — ` +
          `snap to the same y`,
      })
    }
  }

  const textCols = groupColumns(alignTargets.filter(e => isTextLike(e)))
  if (textCols.length === 2) {
    const leftTexts = [...textCols[0]].sort((a, b) => a.y - b.y)
    const rightTexts = [...textCols[1]].sort((a, b) => a.y - b.y)
    const leftTop = leftTexts[0]
    const rightTop = rightTexts[0]
    if (leftTop && rightTop && Math.abs(leftTop.y - rightTop.y) > EDGE_ALIGN_TOL) {
      issues.push({
        kind: 'misalignment',
        elementIds: [leftTop.id, rightTop.id],
        slideId: slide.id,
        message:
          `two-column headers at different y (left ${leftTop.y.toFixed(2)}in vs right ${rightTop.y.toFixed(2)}in) — ` +
          `align ${leftTop.id} and ${rightTop.id} to the same y`,
      })
    }

    const leftBody = leftTexts.slice(1)
    const rightBody = rightTexts.slice(1)
    const usedRight = new Set<string>()
    for (const l of leftBody) {
      const lcy = l.y + l.h / 2
      let best: SlideElement | null = null
      let bestDy = ROW_COL_TOL + 1
      for (const r of rightBody) {
        if (usedRight.has(r.id)) continue
        const dy = Math.abs(lcy - (r.y + r.h / 2))
        if (dy <= ROW_COL_TOL && dy < bestDy) {
          best = r
          bestDy = dy
        }
      }
      if (best && Math.abs(l.y - best.y) > EDGE_ALIGN_TOL) {
        usedRight.add(best.id)
        issues.push({
          kind: 'misalignment',
          elementIds: [l.id, best.id],
          slideId: slide.id,
          message:
            `paired row tops misaligned: ${l.id} y=${l.y.toFixed(2)}in vs ${best.id} y=${best.y.toFixed(2)}in — align tops`,
        })
      }
    }

    const pairs = Math.min(leftBody.length, rightBody.length)
    for (let i = 0; i < pairs - 1; i++) {
      const gapL = leftBody[i + 1].y - (leftBody[i].y + leftBody[i].h)
      const gapR = rightBody[i + 1].y - (rightBody[i].y + rightBody[i].h)
      if (gapL >= 0 && gapR >= 0 && Math.abs(gapL - gapR) > GAP_EVENNESS_TOL) {
        issues.push({
          kind: 'uneven-spacing',
          elementIds: [leftBody[i].id, leftBody[i + 1].id, rightBody[i].id, rightBody[i + 1].id],
          slideId: slide.id,
          message:
            `uneven vertical rhythm between columns (${gapL.toFixed(2)}in left vs ${gapR.toFixed(2)}in right between rows ${i + 2}–${i + 3}) — ` +
            `use equal gaps in both columns`,
        })
      }
    }
  }

  for (const row of groupRows(layout)) {
    for (const el of row) {
      if (!isIconOrImage(el)) continue
      const text = row.find(
        o =>
          o.id !== el.id &&
          isTextLike(o) &&
          o.x >= el.x - 0.02 &&
          o.x < el.x + el.w + 0.4
      )
      if (!text) continue
      const iconCy = el.y + el.h / 2
      const textCy = text.y + text.h / 2
      if (Math.abs(iconCy - textCy) > EDGE_ALIGN_TOL * 2) {
        issues.push({
          kind: 'misalignment',
          elementIds: [el.id, text.id],
          slideId: slide.id,
          message:
            `icon ${el.id} and text ${text.id} vertically off-center in header (Δcenter ${Math.abs(iconCy - textCy).toFixed(2)}in) — align centers on same y`,
        })
      }
    }
  }

  return issues
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
    if (col.length < 2) continue
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
    if (row.length < 2) continue
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
  if (isTextLike(a) && isTextLike(b)) return TEXT_TEXT_OVERLAP_THRESHOLD
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
    return (
      `text blocks ${lower.id} and ${upper.id} overlap by ${pct}% — ` +
      `separate boxes (move/resize x, y, w, h) so they no longer intersect`
    )
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

/** Issues that layout-fix / quick-action passes must resolve (not full margin polish). */
export const LAYOUT_FIX_KINDS = new Set<LayoutIssue['kind']>([
  'overlap',
  'out-of-bounds',
  'text-overflow',
  'misalignment',
  'uneven-spacing',
])

/** Overlap + overflow only — styling passes that must not chase spacing. */
export const GEOMETRY_LAYOUT_KINDS = new Set<LayoutIssue['kind']>([
  'overlap',
  'out-of-bounds',
  'text-overflow',
])

export function isLayoutFixIssue(issue: LayoutIssue): boolean {
  return LAYOUT_FIX_KINDS.has(issue.kind)
}

export function isGeometryLayoutIssue(issue: LayoutIssue): boolean {
  return GEOMETRY_LAYOUT_KINDS.has(issue.kind)
}

export function filterLayoutFixIssues(issues: LayoutIssue[]): LayoutIssue[] {
  return issues.filter(isLayoutFixIssue)
}

export function filterGeometryLayoutIssues(issues: LayoutIssue[]): LayoutIssue[] {
  return issues.filter(isGeometryLayoutIssue)
}

/** Overlap + out-of-bounds only — skip margin/spacing noise during styling-only passes. */
export function filterOverlapOnlyLayoutIssues(issues: LayoutIssue[]): LayoutIssue[] {
  return issues.filter(
    i => i.kind === 'overlap' || i.kind === 'out-of-bounds' || i.kind === 'text-overflow'
  )
}

/** Layout-fix scope: overlaps, clipping, alignment, and even gutters. */
export function findLayoutFixIssues(slide: SlideData): LayoutIssue[] {
  return filterLayoutFixIssues(findLayoutIssues(slide))
}

/** Overlap + out-of-bounds only — for styling-only passes. */
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

  return [...issues, ...findTextOverflowIssues(slide), ...findAlignmentIssues(slide), ...findSpacingAndFillIssues(slide)]
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
      if (
        issue.kind === 'overlap' ||
        issue.kind === 'text-overflow' ||
        issue.kind === 'misalignment' ||
        issue.kind === 'uneven-spacing'
      ) {
        overlapIssues.push(issue)
      }
    }
  }

  return { issues, newIssues, spacingIssues, overlapIssues }
}

export function formatLayoutIssues(issues: LayoutIssue[]): string {
  if (issues.length === 0) return 'no layout issues'
  return issues.map(i => `  - [${i.kind}] ${i.message}`).join('\n')
}

/** Tool-result block for overlap / alignment / overflow checks (layout fix + review). */
export function formatOverlapCheck(issues: LayoutIssue[]): string {
  if (issues.length === 0) {
    return 'LAYOUT CHECK — no overlaps, misalignment, or clipped text detected.'
  }
  return (
    `LAYOUT CHECK — fix before finish:\n${formatLayoutIssues(issues)}\n` +
    `Separate colliding elements; snap column/row edges to a clean grid (same x in columns, same y in rows). ` +
    `Two-column slides: align paired headers and bullet rows across left/right columns with even vertical gaps. ` +
    `For icon + text headers, snap to the same y. For text-overflow, reduce fontSize and/or increase h.`
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
