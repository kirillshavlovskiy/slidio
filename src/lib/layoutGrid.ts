import { SLIDE_H_IN, SLIDE_W_IN } from './layout'

/** Shared slide grid — agent and layout checks align to these tokens. */
export const LAYOUT_GRID = {
  /** Outer slide margins (inches). */
  marginLeft: 0.5,
  marginRight: 0.5,
  marginTop: 0.45,
  marginBottom: 0.4,
  /** Standard gap between stacked elements or columns (inches). */
  rowGutter: 0.18,
  columnGutter: 0.2,
  /** Snap positions/sizes to this step (inches) so elements share edges. */
  snapStep: 0.05,
  /** Unified corner radius (px) for rects, chips, and cards unless a slide already defines one. */
  cornerRadiusPx: 6,
  /** Icon column width when pairing icon + text (inches). */
  iconColumnWidth: 0.48,
  /** Gap between icon and its label (inches). */
  iconTextGap: 0.14,
} as const

export const USABLE_W_IN =
  SLIDE_W_IN - LAYOUT_GRID.marginLeft - LAYOUT_GRID.marginRight
export const USABLE_H_IN =
  SLIDE_H_IN - LAYOUT_GRID.marginTop - LAYOUT_GRID.marginBottom

/** Snapped value on the layout grid. */
export function snapToGrid(inches: number, step = LAYOUT_GRID.snapStep): number {
  return Math.round(inches / step) * step
}

export const GRID_LAYOUT_RULES = `## GRID & ELEMENT MAPPING (mandatory for layout edits)
Treat every slide as a 10×7.5in canvas on a ${LAYOUT_GRID.snapStep}in grid. Map EVERY element to the grid — no arbitrary fractional positions.

OUTER MARGINS (fixed): left ${LAYOUT_GRID.marginLeft}in · right ${LAYOUT_GRID.marginRight}in · top ${LAYOUT_GRID.marginTop}in · bottom ${LAYOUT_GRID.marginBottom}in. Main content lives inside ${USABLE_W_IN}×${USABLE_H_IN}in usable area.

GUTTERS (fixed): ${LAYOUT_GRID.rowGutter}in vertical gap between stacked rows/blocks; ${LAYOUT_GRID.columnGutter}in horizontal gap between columns. All siblings in a stack or row MUST use the SAME gutter — never mix 0.1in and 0.35in gaps.

SNAP: round x, y, w, h to the nearest ${LAYOUT_GRID.snapStep}in. Shared edges (column lefts, row tops, table cell bounds) must use IDENTICAL coordinates across elements.

CORNER RADIUS: use style.borderRadius = ${LAYOUT_GRID.cornerRadiusPx} (px) on ALL rects/chips/cards in a layout pass unless the slide already has a different unified radius — then match that one value everywhere.

ICON + TEXT ROWS: icon column w≈${LAYOUT_GRID.iconColumnWidth}in, then ${LAYOUT_GRID.iconTextGap}in gap, then text — boxes must NOT overlap. Vertically center icon and text to the same row y/h.

NO OVERLAPS: after grid-snapping, verify every pair has non-intersecting boxes. Equalize row heights in tables/lists so the grid stays regular.`
