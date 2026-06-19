'use client'
import { useRef, useState } from 'react'
import { Paperclip, Check, X } from 'lucide-react'
import { SlideData, SlideElement, ElementStyle } from '@/lib/types'
import { elementFillHex, elementTextHex, isFillElement } from '@/lib/elementStyle'
import { slideBackgroundStyle, gradientCss } from '@/lib/slideBackground'
import { fontFamilyCss } from '@/lib/fonts'
import { knowledgeSnapTargets } from '@/lib/deckKnowledgeLinks'
import ElementTextEditor from '@/components/ElementTextEditor'
import ChartElement from '@/components/ChartElement'
import { getIcon } from '@/lib/icons'

interface Props {
  slide: SlideData
  selectedElementIds?: string[]
  highlightedElementIds?: string[]
  deletedElementIds?: string[]
  highlightColor?: 'blue' | 'amber' | 'green'
  /** Preview-only: toggles diff overlays (amber/green/red). Does not affect selection. */
  showDiffHighlights?: boolean
  editingElementId?: string | null
  scale?: number
  showShadow?: boolean
  onElementClick?: (id: string) => void
  onElementDoubleClick?: (id: string) => void
  onElementUpdate?: (
    id: string,
    patch: { content?: string; style?: Partial<ElementStyle>; x?: number; y?: number; w?: number; h?: number }
  ) => void
  /** Live geometry update during a resize drag (should NOT record history per frame). */
  onElementResize?: (id: string, geom: { x: number; y: number; w: number; h: number }) => void
  /** Called once at the start of a resize drag so it becomes a single undo step. */
  onElementResizeStart?: () => void
  onEditingEnd?: () => void
  onCanvasClick?: () => void
  /** Double-click on empty slide area (not on an element). Used to open slide-level editing. */
  onCanvasDoubleClick?: () => void
  /** Called while/after dragging a marquee over empty canvas; receives ids inside the rect. */
  onMarqueeSelect?: (ids: string[]) => void
  /** Element ids linked to the knowledge graph on this slide (deck mapping). */
  knowledgeLinkedElementIds?: Set<string>
  /** Tooltip metadata for knowledge-linked elements. */
  knowledgeLinkByElementId?: Map<string, { knowledgeName: string; knowledgeType: string }>
  /** Show knowledge-link pin badges on elements (no surrounding box). */
  showKnowledgePins?: boolean
  /** Per-change review: element ids with pending amendments on this slide. */
  amendmentElementIds?: string[]
  /** Checkpoint slide (before amendments) — renders amber ghost boxes at prior geometry. */
  compareSlide?: SlideData | null
  /** Review mode: allow selection + per-element controls but block drag/resize. */
  amendmentReview?: boolean
  onAcceptAmendment?: (elementId: string) => void
  onDeclineAmendment?: (elementId: string) => void
  interactive?: boolean
}

const SCALE = 96
const SLIDE_W_IN = 10
const SLIDE_H_IN = 7.5

const HIGHLIGHT_COLORS = {
  blue: { border: '#60a5fa', glow: 'rgba(96,165,250,0.55)' },
  amber: { border: '#fbbf24', glow: 'rgba(251,191,36,0.65)' },
  green: { border: '#4ade80', glow: 'rgba(74,222,128,0.65)' },
}

const DEFAULT_FILLS: Record<string, string> = {
  bar: '#60a5fa',
  rect: '#112236',
  chip: '#112236',
}

const MIN_ELEMENT_SIZE = 0.01 // inches (allow thin bars / hairline separators)

// Pick a readable chart text color (axes/legend) from the slide background luminance.
function chartTextColor(bg: string): string {
  const h = (bg || '').replace('#', '')
  if (h.length < 6) return 'CBD5E1'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.55 ? '334155' : 'CBD5E1'
}

// ── Smart alignment guides (snap-to lines) ───────────────────────────────────
// Screen-px distance within which a moving edge/center snaps to an alignment line.
// Compared in screen pixels so it feels the same at any zoom; hold Alt to disable.
const SNAP_PX = 7

/** Candidate vertical (xs) / horizontal (ys) alignment lines, in inches. */
function snapLinesFrom(siblings: SlideElement[]): { xs: number[]; ys: number[] } {
  const xs: number[] = [0, SLIDE_W_IN / 2, SLIDE_W_IN]
  const ys: number[] = [0, SLIDE_H_IN / 2, SLIDE_H_IN]
  for (const s of siblings) {
    xs.push(s.x, s.x + s.w / 2, s.x + s.w)
    ys.push(s.y, s.y + s.h / 2, s.y + s.h)
  }
  return { xs, ys }
}

/** Nearest line to `v` within `thresh` (inches), or null when nothing is close. */
function snapValue(v: number, lines: number[], thresh: number): number | null {
  let best: number | null = null
  let bestD = thresh
  for (const c of lines) {
    const d = Math.abs(v - c)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

/** A guide line + the extent (start..end, inches) it spans on the other axis. */
interface GuideLine {
  pos: number
  start: number
  end: number
}
interface Guides {
  x: GuideLine[]
  y: GuideLine[]
}
const NO_GUIDES: Guides = { x: [], y: [] }
const GUIDE_PAD = 0.08 // inches of overshoot past the aligned elements

/** Vertical guide at x=`pos`: spans the y-range covering the moving element and
 *  every sibling whose edge/center sits on the same line. */
function vGuide(
  pos: number,
  moving: { y: number; h: number },
  siblings: SlideElement[]
): GuideLine {
  const eps = 0.02
  let top = moving.y
  let bot = moving.y + moving.h
  for (const s of siblings) {
    if (
      Math.abs(s.x - pos) < eps ||
      Math.abs(s.x + s.w / 2 - pos) < eps ||
      Math.abs(s.x + s.w - pos) < eps
    ) {
      top = Math.min(top, s.y)
      bot = Math.max(bot, s.y + s.h)
    }
  }
  return { pos, start: top - GUIDE_PAD, end: bot + GUIDE_PAD }
}

/** Horizontal guide at y=`pos`: spans the x-range. */
function hGuide(
  pos: number,
  moving: { x: number; w: number },
  siblings: SlideElement[]
): GuideLine {
  const eps = 0.02
  let left = moving.x
  let right = moving.x + moving.w
  for (const s of siblings) {
    if (
      Math.abs(s.y - pos) < eps ||
      Math.abs(s.y + s.h / 2 - pos) < eps ||
      Math.abs(s.y + s.h - pos) < eps
    ) {
      left = Math.min(left, s.x)
      right = Math.max(right, s.x + s.w)
    }
  }
  return { pos, start: left - GUIDE_PAD, end: right + GUIDE_PAD }
}

interface ResizeHandleDef {
  key: string
  cx: number
  cy: number
  cursor: string
  edges: { l?: boolean; r?: boolean; t?: boolean; b?: boolean }
}

const RESIZE_HANDLES: ResizeHandleDef[] = [
  { key: 'nw', cx: 0, cy: 0, cursor: 'nwse-resize', edges: { l: true, t: true } },
  { key: 'n', cx: 0.5, cy: 0, cursor: 'ns-resize', edges: { t: true } },
  { key: 'ne', cx: 1, cy: 0, cursor: 'nesw-resize', edges: { r: true, t: true } },
  { key: 'e', cx: 1, cy: 0.5, cursor: 'ew-resize', edges: { r: true } },
  { key: 'se', cx: 1, cy: 1, cursor: 'nwse-resize', edges: { r: true, b: true } },
  { key: 's', cx: 0.5, cy: 1, cursor: 'ns-resize', edges: { b: true } },
  { key: 'sw', cx: 0, cy: 1, cursor: 'nesw-resize', edges: { l: true, b: true } },
  { key: 'w', cx: 0, cy: 0.5, cursor: 'ew-resize', edges: { l: true } },
]

/**
 * Selection chrome rendered as a separate top overlay so it never promotes the
 * element's opaque background above other elements (which used to hide content
 * sitting underneath the selected element).
 */
function SelectionOverlay({
  element,
  scale,
  color,
  showHandles,
  siblings,
  onResize,
  onResizeStart,
  onGuides,
}: {
  element: SlideElement
  scale: number
  color: string
  showHandles: boolean
  siblings: SlideElement[]
  onResize?: (geom: { x: number; y: number; w: number; h: number }) => void
  onResizeStart?: () => void
  onGuides?: (g: Guides) => void
}) {
  const startResize = (handle: ResizeHandleDef, e: React.MouseEvent) => {
    if (!onResize) return
    e.preventDefault()
    e.stopPropagation()
    onResizeStart?.()
    const startX = e.clientX
    const startY = e.clientY
    const init = { x: element.x, y: element.y, w: element.w, h: element.h }
    const pxPerInch = SCALE * scale
    const lines = snapLinesFrom(siblings)

    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / pxPerInch
      const dy = (ev.clientY - startY) / pxPerInch
      let { x, y, w, h } = init
      if (handle.edges.l) {
        x = init.x + dx
        w = init.w - dx
      }
      if (handle.edges.r) w = init.w + dx
      if (handle.edges.t) {
        y = init.y + dy
        h = init.h - dy
      }
      if (handle.edges.b) h = init.h + dy

      // Snap the edges that are actually being dragged to nearby alignment
      // lines and remember which lines to draw. Hold Alt for free resize.
      let snapX: number | null = null
      let snapY: number | null = null
      if (!ev.altKey) {
        const thresh = SNAP_PX / pxPerInch
        if (handle.edges.l) {
          const s = snapValue(x, lines.xs, thresh)
          if (s != null) {
            w += x - s
            x = s
            snapX = s
          }
        }
        if (handle.edges.r) {
          const s = snapValue(x + w, lines.xs, thresh)
          if (s != null) {
            w = s - x
            snapX = s
          }
        }
        if (handle.edges.t) {
          const s = snapValue(y, lines.ys, thresh)
          if (s != null) {
            h += y - s
            y = s
            snapY = s
          }
        }
        if (handle.edges.b) {
          const s = snapValue(y + h, lines.ys, thresh)
          if (s != null) {
            h = s - y
            snapY = s
          }
        }
      }

      if (w < MIN_ELEMENT_SIZE) {
        if (handle.edges.l) x = init.x + init.w - MIN_ELEMENT_SIZE
        w = MIN_ELEMENT_SIZE
      }
      if (h < MIN_ELEMENT_SIZE) {
        if (handle.edges.t) y = init.y + init.h - MIN_ELEMENT_SIZE
        h = MIN_ELEMENT_SIZE
      }
      onGuides?.({
        x: snapX != null ? [vGuide(snapX, { y, h }, siblings)] : [],
        y: snapY != null ? [hGuide(snapY, { x, w }, siblings)] : [],
      })
      onResize({ x, y, w, h })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      onGuides?.(NO_GUIDES)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // The visible outline hugs the element exactly. For hairline/short elements
  // (thin bars, separators) the 8 handles would pile up on top of each other,
  // so we push the edge handles OUTWARD just enough to stay individually
  // grabbable — without ever moving the outline off the element.
  const MIN_HANDLE_SPREAD_PX = 18
  const rawW = element.w * SCALE
  const rawH = element.h * SCALE
  const spreadX = Math.max(0, (MIN_HANDLE_SPREAD_PX - rawW) / 2)
  const spreadY = Math.max(0, (MIN_HANDLE_SPREAD_PX - rawH) / 2)

  return (
    <div
      style={{
        position: 'absolute',
        left: element.x * SCALE,
        top: element.y * SCALE,
        width: rawW,
        height: rawH,
        // Use outline (drawn outside the box, no layout space) instead of
        // border so hairline elements aren't forced wider than 2*borderWidth.
        outline: `2px solid ${color}`,
        outlineOffset: 0,
        boxSizing: 'border-box',
        pointerEvents: 'none',
        zIndex: 60,
      }}
    >
      {showHandles &&
        RESIZE_HANDLES.map(h => (
          <div
            key={h.key}
            onMouseDown={e => startResize(h, e)}
            style={{
              position: 'absolute',
              left: h.cx * rawW + (h.cx * 2 - 1) * spreadX,
              top: h.cy * rawH + (h.cy * 2 - 1) * spreadY,
              width: 10,
              height: 10,
              transform: 'translate(-50%, -50%)',
              backgroundColor: '#fff',
              border: `2px solid ${color}`,
              borderRadius: 2,
              boxShadow: '0 0 0 1px rgba(0,0,0,0.35)',
              cursor: h.cursor,
              pointerEvents: 'auto',
            }}
          />
        ))}
    </div>
  )
}

function isTextEditable(el: SlideElement) {
  return el.type === 'text' || el.type === 'chip'
}

// An image src that's still a name reference (e.g. "logo:Deel") means the asset
// wasn't found — render a visible placeholder instead of a broken <img>.
const UNRESOLVED_ASSET_REF = /^@?(asset|image|img|media|logo|photo|pic|icon)\s*:/i

function elementStyle(el: SlideElement): React.CSSProperties {
  const s = el.style || {}
  const fill = elementFillHex(el)
  const hasFill = isFillElement(el)
  // Bars render no text, so horizontal/vertical padding would inflate their
  // visible size beyond their logical w/h (a 1.44px bar would render ~12px
  // wide). Render them with exact geometry and no padding.
  const isBar = el.type === 'bar'
  const isImage = el.type === 'image'
  const isChart = el.type === 'chart'
  const isIcon = el.type === 'icon'

  // Text insets. Defaults give ~6px horizontal / ~2px vertical breathing room,
  // but the AI / user can override per-side (in inches) via style.padLeft etc.
  // This is what creates space between a left accent bar and the text content.
  const padLeftPx = s.padLeft != null ? s.padLeft * SCALE : 6
  const padRightPx = s.padRight != null ? s.padRight * SCALE : 6
  const padTopPx = s.padTop != null ? s.padTop * SCALE : 2
  const padBottomPx = s.padBottom != null ? s.padBottom * SCALE : 2

  const hasBorder = s.borderWidth != null && s.borderWidth > 0

  return {
    position: 'absolute',
    left: el.x * SCALE,
    top: el.y * SCALE,
    width: el.w * SCALE,
    height: el.h * SCALE,
    boxSizing: 'border-box',
    fontSize: (s.fontSize || 12) * 1.2,
    fontFamily: fontFamilyCss(s.fontFace),
    fontWeight: s.fontWeight ?? (s.bold ? 700 : 400),
    fontStyle: s.italic ? 'italic' : 'normal',
    color: el.type === 'bar' ? 'transparent' : `#${elementTextHex(el)}`,
    // Honor an explicit style.bg on ANY element (e.g. zebra-striped text rows),
    // not just shapes — otherwise text-row backgrounds silently disappear.
    backgroundColor: s.bg
      ? `#${s.bg}`
      : hasFill
        ? fill
          ? `#${fill}`
          : DEFAULT_FILLS[el.type]
        : 'transparent',
    // A gradient fill (e.g. imported from PPTX) paints over the solid color.
    backgroundImage: s.bgGradient ? gradientCss(s.bgGradient) : undefined,
    textAlign: (s.align as React.CSSProperties['textAlign']) || 'left',
    letterSpacing: s.charSpacing ? `${s.charSpacing * 0.06}em` : undefined,
    display: 'flex',
    alignItems: s.valign === 'top' ? 'flex-start' : s.valign === 'bottom' ? 'flex-end' : 'center',
    justifyContent: s.align === 'center' ? 'center' : s.align === 'right' ? 'flex-end' : 'flex-start',
    padding: isBar || isImage || isChart || isIcon
      ? 0
      : `${padTopPx}px ${padRightPx}px ${padBottomPx}px ${padLeftPx}px`,
    whiteSpace: 'pre-wrap',
    lineHeight: s.lineHeight ?? 1.25,
    overflow: 'hidden',
    cursor: 'pointer',
    borderRadius: s.borderRadius != null ? s.borderRadius : el.type === 'chip' ? 2 : 0,
    border: hasBorder
      ? `${s.borderWidth}px ${s.borderStyle || 'solid'} #${s.borderColor || '334155'}`
      : undefined,
    opacity: s.opacity != null ? s.opacity / 100 : undefined,
    userSelect: 'none',
  }
}

export default function SlideCanvas({
  slide,
  selectedElementIds = [],
  highlightedElementIds = [],
  deletedElementIds = [],
  highlightColor = 'blue',
  showDiffHighlights = false,
  editingElementId = null,
  scale = 1,
  showShadow = true,
  onElementClick,
  onElementDoubleClick,
  onElementUpdate,
  onElementResize,
  onElementResizeStart,
  onEditingEnd,
  onCanvasClick,
  onCanvasDoubleClick,
  onMarqueeSelect,
  knowledgeLinkedElementIds,
  knowledgeLinkByElementId,
  showKnowledgePins = true,
  amendmentElementIds = [],
  compareSlide = null,
  amendmentReview = false,
  onAcceptAmendment,
  onDeclineAmendment,
  interactive = true,
}: Props) {
  const colors = HIGHLIGHT_COLORS[highlightColor]
  const width = 960 * scale
  const height = 720 * scale
  const slideRef = useRef<HTMLDivElement>(null)
  // After a drag the browser still fires a click; this swallows it so the drag
  // doesn't get interpreted as a (de)select toggle.
  const suppressClickRef = useRef(false)
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null
  )
  // Active smart-guide lines (in inches) drawn while dragging / resizing.
  const [guides, setGuides] = useState<Guides>(NO_GUIDES)
  const [guidesKnowledge, setGuidesKnowledge] = useState(false)

  const linkedOnSlide = showKnowledgePins ? (knowledgeLinkedElementIds ?? new Set<string>()) : new Set<string>()

  const snapSiblingsFor = (movingIds: string[]) => {
    const others = slide.elements.filter(s2 => !movingIds.includes(s2.id))
    const knowledgeTargets = showKnowledgePins
      ? knowledgeSnapTargets(others, movingIds, linkedOnSlide)
      : []
    const useKnowledge = showKnowledgePins && knowledgeTargets.length > 0 && knowledgeTargets.length < others.length
    return { siblings: useKnowledge ? knowledgeTargets : others, useKnowledge }
  }

  const elementsInRect = (m: { x0: number; y0: number; x1: number; y1: number }) => {
    const minX = Math.min(m.x0, m.x1)
    const maxX = Math.max(m.x0, m.x1)
    const minY = Math.min(m.y0, m.y1)
    const maxY = Math.max(m.y0, m.y1)
    return slide.elements
      .filter(el => {
        const l = el.x * SCALE
        const r = (el.x + el.w) * SCALE
        const t = el.y * SCALE
        const b = (el.y + el.h) * SCALE
        return !(r < minX || l > maxX || b < minY || t > maxY)
      })
      .map(el => el.id)
  }

  // Drag an element (or the whole multi-selection) by its body to reposition it.
  const startElementDrag = (el: SlideElement, e: React.MouseEvent) => {
    if (amendmentReview) return
    if (!interactive || e.button !== 0 || editingElementId === el.id || !onElementResize) return
    e.stopPropagation()
    const isSelected = selectedElementIds.includes(el.id)
    const groupIds = isSelected && selectedElementIds.length > 0 ? selectedElementIds : [el.id]
    const inits = new Map<string, { x: number; y: number; w: number; h: number }>()
    for (const id of groupIds) {
      const g = slide.elements.find(s2 => s2.id === id)
      if (g) inits.set(id, { x: g.x, y: g.y, w: g.w, h: g.h })
    }
    const startX = e.clientX
    const startY = e.clientY
    const pxPerInch = SCALE * scale
    const primaryInit = inits.get(el.id) ?? { x: el.x, y: el.y, w: el.w, h: el.h }
    const { siblings: snapSiblings, useKnowledge } = snapSiblingsFor(groupIds)
    const lines = snapLinesFrom(snapSiblings)
    let moved = false
    let started = false

    const onMove = (ev: MouseEvent) => {
      if (!moved && (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3)) {
        moved = true
      }
      if (!moved) return
      if (!started) {
        started = true
        onElementResizeStart?.()
        if (!isSelected) onElementClick?.(el.id)
        setGuidesKnowledge(useKnowledge)
      }
      const dx = (ev.clientX - startX) / pxPerInch
      const dy = (ev.clientY - startY) / pxPerInch

      // Snap the primary element's left/center/right (and top/center/bottom)
      // to the nearest alignment line, then shift the whole group by the same
      // offset so relative positions are preserved. Hold Alt for free move.
      let snapDX = 0
      let snapDY = 0
      let lineX: number | null = null
      let lineY: number | null = null
      if (!ev.altKey) {
        const thresh = SNAP_PX / pxPerInch
        const baseX = primaryInit.x + dx
        const anchorsX = [baseX, baseX + primaryInit.w / 2, baseX + primaryInit.w]
        let bestXd = thresh
        for (const a of anchorsX) {
          const s = snapValue(a, lines.xs, thresh)
          if (s != null && Math.abs(a - s) < bestXd) {
            bestXd = Math.abs(a - s)
            snapDX = s - a
            lineX = s
          }
        }
        const baseY = primaryInit.y + dy
        const anchorsY = [baseY, baseY + primaryInit.h / 2, baseY + primaryInit.h]
        let bestYd = thresh
        for (const a of anchorsY) {
          const s = snapValue(a, lines.ys, thresh)
          if (s != null && Math.abs(a - s) < bestYd) {
            bestYd = Math.abs(a - s)
            snapDY = s - a
            lineY = s
          }
        }
      }

      inits.forEach((init, id) => {
        const nx = Math.max(0, Math.min(init.x + dx + snapDX, SLIDE_W_IN - init.w))
        const ny = Math.max(0, Math.min(init.y + dy + snapDY, SLIDE_H_IN - init.h))
        onElementResize(id, { x: nx, y: ny, w: init.w, h: init.h })
      })
      const snapSibs = snapSiblings
      const pfx = Math.max(0, Math.min(primaryInit.x + dx + snapDX, SLIDE_W_IN - primaryInit.w))
      const pfy = Math.max(0, Math.min(primaryInit.y + dy + snapDY, SLIDE_H_IN - primaryInit.h))
      setGuides({
        x: lineX != null ? [vGuide(lineX, { y: pfy, h: primaryInit.h }, snapSibs)] : [],
        y: lineY != null ? [hGuide(lineY, { x: pfx, w: primaryInit.w }, snapSibs)] : [],
      })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      setGuides(NO_GUIDES)
      setGuidesKnowledge(false)
      if (moved) suppressClickRef.current = true
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const onSlideMouseDown = (e: React.MouseEvent) => {
    if (!interactive || e.button !== 0) return
    // Only start a marquee on empty canvas, not on an element.
    if (e.target !== e.currentTarget) return
    const rect = slideRef.current?.getBoundingClientRect()
    if (!rect) return
    const startX = (e.clientX - rect.left) / scale
    const startY = (e.clientY - rect.top) / scale
    let dragged = false
    setMarquee({ x0: startX, y0: startY, x1: startX, y1: startY })

    const onMove = (ev: MouseEvent) => {
      const curX = Math.min(960, Math.max(0, (ev.clientX - rect.left) / scale))
      const curY = Math.min(720, Math.max(0, (ev.clientY - rect.top) / scale))
      if (Math.abs(curX - startX) > 3 || Math.abs(curY - startY) > 3) dragged = true
      const m = { x0: startX, y0: startY, x1: curX, y1: curY }
      setMarquee(m)
      if (dragged) onMarqueeSelect?.(elementsInRect(m))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      setMarquee(null)
      if (!dragged) onCanvasClick?.()
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      style={{
        width,
        height,
        flexShrink: 0,
      }}
    >
      <div
        ref={slideRef}
        onMouseDown={interactive ? onSlideMouseDown : undefined}
        onDoubleClick={
          interactive && onCanvasDoubleClick
            ? e => {
                // Only when double-clicking the empty slide surface, not an element.
                if (e.target === e.currentTarget) onCanvasDoubleClick()
              }
            : undefined
        }
        style={{
          position: 'relative',
          // Contain ALL internal z-indexes (selection outline, handles, guides,
          // inline editor) inside this stacking context so they can never paint
          // over modals/panels. Without this the canvas only isolates when a
          // scale() transform is present (i.e. not at 100% zoom).
          isolation: 'isolate',
          width: 960,
          height: 720,
          ...slideBackgroundStyle(slide),
          boxShadow: showShadow ? '0 8px 40px rgba(0,0,0,0.6)' : undefined,
          transform: scale !== 1 ? `scale(${scale})` : undefined,
          transformOrigin: 'top left',
          cursor: interactive || amendmentReview ? 'crosshair' : undefined,
          overflow: amendmentReview ? 'visible' : undefined,
        }}
      >
        {showDiffHighlights &&
          compareSlide?.elements.map(oldEl => {
            if (!amendmentElementIds.includes(oldEl.id)) return null
            const newEl = slide.elements.find(e => e.id === oldEl.id)
            if (!newEl) return null
            const moved =
              oldEl.x !== newEl.x ||
              oldEl.y !== newEl.y ||
              oldEl.w !== newEl.w ||
              oldEl.h !== newEl.h
            if (!moved) return null
            return (
              <div
                key={`ghost-${oldEl.id}`}
                style={{
                  position: 'absolute',
                  left: oldEl.x * SCALE,
                  top: oldEl.y * SCALE,
                  width: oldEl.w * SCALE,
                  height: oldEl.h * SCALE,
                  border: '2px dashed #fbbf24',
                  background: 'rgba(251,191,36,0.12)',
                  boxShadow: '0 0 12px rgba(251,191,36,0.35)',
                  pointerEvents: 'none',
                  zIndex: 8,
                }}
                title="Previous position"
              />
            )
          })}
        {slide.elements.map(el => {
          const diffHighlighted = highlightedElementIds.includes(el.id)
          const deleted = deletedElementIds.includes(el.id)
          const showDiff = showDiffHighlights && (diffHighlighted || deleted)
          const isEditing = editingElementId === el.id
          const editable = isTextEditable(el)
          const isKbLinked = showKnowledgePins && linkedOnSlide.has(el.id)
          const kbLink = knowledgeLinkByElementId?.get(el.id)
          const kbTitle = kbLink
            ? `Linked to ${kbLink.knowledgeName} (${kbLink.knowledgeType})`
            : isKbLinked
              ? 'Linked to knowledge graph'
              : undefined
          const hasAmendment = amendmentElementIds.includes(el.id)
          const showAmendmentControls =
            showDiffHighlights &&
            hasAmendment &&
            !!onAcceptAmendment &&
            !!onDeclineAmendment &&
            !isEditing

          return (
            <div
              key={el.id}
              style={{
                ...elementStyle(el),
                cursor:
                  interactive || amendmentReview
                    ? isEditing
                      ? 'text'
                      : amendmentReview
                        ? 'pointer'
                        : 'move'
                    : 'default',
                opacity: deleted && showDiffHighlights ? 0.55 : 1,
                zIndex: isEditing ? 100 : showDiff ? 15 : showAmendmentControls ? 20 : undefined,
                overflow: isEditing || showAmendmentControls || (diffHighlighted && showDiffHighlights) ? 'visible' : 'hidden',
                boxShadow: undefined,
              }}
              onMouseDown={
                interactive && !isEditing && !amendmentReview ? e => startElementDrag(el, e) : undefined
              }
              onClick={
                (interactive || amendmentReview) && onElementClick && !isEditing
                  ? e => {
                      e.stopPropagation()
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false
                        return
                      }
                      onElementClick(el.id)
                    }
                  : undefined
              }
              onDoubleClick={
                interactive && editable && onElementDoubleClick
                  ? e => {
                      e.stopPropagation()
                      onElementDoubleClick(el.id)
                    }
                  : undefined
              }
              title={kbTitle ?? (editable ? `${el.id} — double-click to edit` : el.id)}
            >
              {showAmendmentControls && (
                <div
                  style={{
                    position: 'absolute',
                    top: -30,
                    right: 0,
                    zIndex: 60,
                    display: 'flex',
                    gap: 4,
                    pointerEvents: 'auto',
                  }}
                  onClick={e => e.stopPropagation()}
                  onMouseDown={e => e.stopPropagation()}
                >
                  <button
                    type="button"
                    title="Accept this change"
                    onClick={() => onAcceptAmendment!(el.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 26,
                      height: 26,
                      borderRadius: 6,
                      border: '1px solid rgba(34,197,94,0.65)',
                      background: 'rgba(20,83,45,0.95)',
                      color: '#86efac',
                      cursor: 'pointer',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
                    }}
                  >
                    <Check style={{ width: 14, height: 14 }} strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    title="Decline this change"
                    onClick={() => onDeclineAmendment!(el.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 26,
                      height: 26,
                      borderRadius: 6,
                      border: '1px solid rgba(239,68,68,0.65)',
                      background: 'rgba(69,10,10,0.95)',
                      color: '#fca5a5',
                      cursor: 'pointer',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
                    }}
                  >
                    <X style={{ width: 14, height: 14 }} strokeWidth={2.5} />
                  </button>
                </div>
              )}
              {isKbLinked && (
                <div
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    zIndex: 22,
                    pointerEvents: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    background: 'rgba(6, 182, 212, 0.92)',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
                  }}
                  title={kbTitle}
                >
                  <Paperclip style={{ width: 10, height: 10, color: '#fff' }} strokeWidth={2.5} />
                </div>
              )}
              {deleted && showDiffHighlights && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    border: '2px dashed #ef4444',
                    pointerEvents: 'none',
                    zIndex: 11,
                  }}
                />
              )}
              {diffHighlighted && showDiffHighlights && !deleted && (
                <div
                  style={{
                    position: 'absolute',
                    inset: -2,
                    border: `2px dashed ${colors.border}`,
                    boxShadow: `0 0 0 1px rgba(0,0,0,0.45), 0 0 14px ${colors.glow}`,
                    pointerEvents: 'none',
                    zIndex: 12,
                  }}
                />
              )}
              {isEditing && onElementUpdate && onEditingEnd ? (
                <ElementTextEditor
                  element={el}
                  onUpdate={patch => onElementUpdate(el.id, patch)}
                  onEnd={onEditingEnd}
                />
              ) : el.type === 'bar' ? null : el.type === 'chart' && el.chart ? (
                <ChartElement
                  spec={el.chart}
                  width={el.w * SCALE}
                  height={el.h * SCALE}
                  textColor={el.style?.color || chartTextColor(slide.bg)}
                />
              ) : el.type === 'icon' ? (
                (() => {
                  const Icon = getIcon(el.icon)
                  return (
                    <Icon
                      color={`#${elementTextHex(el)}`}
                      strokeWidth={el.style?.iconStrokeWidth ?? 2}
                      style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
                    />
                  )
                })()
              ) : el.type === 'image' ? (
                el.src && !UNRESOLVED_ASSET_REF.test(el.src) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={el.src}
                    alt={el.content || el.id}
                    draggable={false}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: el.style?.objectFit || 'contain',
                      filter: el.style?.invert ? 'invert(1)' : undefined,
                      pointerEvents: 'none',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 2,
                      border: '1px dashed #94a3b8',
                      borderRadius: 4,
                      pointerEvents: 'none',
                      fontSize: 9,
                      lineHeight: 1.2,
                      color: '#94a3b8',
                      textAlign: 'center',
                      padding: 2,
                      overflow: 'hidden',
                    }}
                  >
                    <span style={{ fontSize: 11 }}>🖼️</span>
                    <span>
                      {el.src && UNRESOLVED_ASSET_REF.test(el.src)
                        ? `missing: ${el.src.replace(UNRESOLVED_ASSET_REF, '')}`
                        : el.content || 'image'}
                    </span>
                  </div>
                )
              ) : (
                <span style={{ position: 'relative', zIndex: 1, pointerEvents: 'none' }}>
                  {el.content}
                </span>
              )}
            </div>
          )
        })}
        {interactive &&
          slide.elements
            .filter(el => selectedElementIds.includes(el.id) && editingElementId !== el.id)
            .map(el => {
              const { siblings: resizeSiblings, useKnowledge: resizeKnowledge } = snapSiblingsFor([el.id])
              return (
              <SelectionOverlay
                key={`selection-${el.id}`}
                element={el}
                scale={scale}
                color={HIGHLIGHT_COLORS.blue.border}
                showHandles={!!onElementResize && selectedElementIds.length === 1}
                siblings={resizeSiblings}
                onResize={
                  onElementResize ? geom => onElementResize(el.id, geom) : undefined
                }
                onResizeStart={() => {
                  setGuidesKnowledge(resizeKnowledge)
                  onElementResizeStart?.()
                }}
                onGuides={g => {
                  setGuides(g)
                  if (g.x.length === 0 && g.y.length === 0) setGuidesKnowledge(false)
                }}
              />
            )})}
        {(guides.x.length > 0 || guides.y.length > 0) && (
          <>
            {guides.x.map((g, i) => (
              <div
                key={`guide-x-${i}`}
                style={{
                  position: 'absolute',
                  left: g.pos * SCALE,
                  top: Math.max(0, g.start * SCALE),
                  width: 0,
                  height: (Math.min(720, g.end * SCALE) - Math.max(0, g.start * SCALE)),
                  borderLeft: `1px dashed ${guidesKnowledge ? '#22d3ee' : '#ef4444'}`,
                  pointerEvents: 'none',
                  zIndex: 80,
                }}
              />
            ))}
            {guides.y.map((g, i) => (
              <div
                key={`guide-y-${i}`}
                style={{
                  position: 'absolute',
                  left: Math.max(0, g.start * SCALE),
                  top: g.pos * SCALE,
                  width: (Math.min(960, g.end * SCALE) - Math.max(0, g.start * SCALE)),
                  height: 0,
                  borderTop: `1px dashed ${guidesKnowledge ? '#22d3ee' : '#ef4444'}`,
                  pointerEvents: 'none',
                  zIndex: 80,
                }}
              />
            ))}
          </>
        )}
        {marquee && (
          <div
            style={{
              position: 'absolute',
              left: Math.min(marquee.x0, marquee.x1),
              top: Math.min(marquee.y0, marquee.y1),
              width: Math.abs(marquee.x1 - marquee.x0),
              height: Math.abs(marquee.y1 - marquee.y0),
              border: `1px solid ${HIGHLIGHT_COLORS.blue.border}`,
              backgroundColor: 'rgba(96,165,250,0.15)',
              pointerEvents: 'none',
              zIndex: 70,
            }}
          />
        )}
      </div>
    </div>
  )
}
