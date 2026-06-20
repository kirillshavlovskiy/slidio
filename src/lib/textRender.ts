import type { CSSProperties } from 'react'
import type { ElementStyle, SlideElement } from './types'
import { CANVAS_FONT_SCALE, CANVAS_PX_PER_IN } from './slideDimensions'

/** Stored pt → canvas CSS px (96dpi slide). */
export function canvasFontSizePx(fontSizePt: number): number {
  return fontSizePt * CANVAS_FONT_SCALE
}

/** Vertical alignment when style.valign is omitted (matches PowerPoint title/body defaults). */
export function effectiveTextValign(
  el: SlideElement,
  s: ElementStyle = el.style ?? {}
): NonNullable<ElementStyle['valign']> {
  if (s.valign) return s.valign
  if (el.type === 'chip') return 'middle'
  const align = s.align ?? (el.type === 'text' ? 'left' : 'center')
  return align === 'left' ? 'top' : 'middle'
}

export function effectiveLineHeight(s: ElementStyle, lineCount = 1): number {
  if (s.lineHeight != null) return s.lineHeight
  if (lineCount >= 2) return s.bold ? 1.34 : 1.3
  return s.bold ? 1.22 : 1.25
}

/** Extra inset so ascenders/descenders are not clipped inside short boxes. */
export function textMetricsPaddingPx(fontSizePx: number): { top: number; bottom: number } {
  if (fontSizePx >= 28) return { top: Math.round(fontSizePx * 0.1), bottom: Math.round(fontSizePx * 0.12) }
  if (fontSizePx >= 16) return { top: Math.round(fontSizePx * 0.07), bottom: Math.round(fontSizePx * 0.09) }
  return { top: Math.max(1, Math.round(fontSizePx * 0.05)), bottom: Math.max(1, Math.round(fontSizePx * 0.06)) }
}

/**
 * Prefer a line break after "Label:" for long single-line titles so wrapped copy
 * reads as title + subtitle (e.g. "Authorization Paradigm:" / "Default-Allow vs…").
 */
export function displayTextContent(content: string): string {
  if (!content || content.includes('\n')) return content
  const match = content.match(/^([^:]{3,80}):\s+(\S[\s\S]+)$/)
  if (!match) return content
  const body = match[2].trim()
  if (body.split(/\s+/).length < 2) return content
  return `${match[1]}:\n${body}`
}

function estimateLineCount(content: string, innerWidthPx: number, fontSizePx: number): number {
  const lines = content.split('\n')
  const charWidth = fontSizePx * 0.52
  const charsPerLine = Math.max(4, Math.floor(innerWidthPx / charWidth))
  let total = 0
  for (const raw of lines) {
    const t = raw.trim()
    if (!t) {
      total += 1
      continue
    }
    total += Math.max(1, Math.ceil(t.length / charsPerLine))
  }
  return Math.max(1, total)
}

/** Shrink display size until the text block fits the inner box (PowerPoint-style). */
export function fittedCanvasFontSizePx(
  s: ElementStyle,
  innerWidthPx: number,
  innerHeightPx: number,
  displayedContent: string
): number {
  const targetPt = s.fontSize ?? 12
  let px = canvasFontSizePx(targetPt)
  const minPx = canvasFontSizePx(6)

  const heightFor = (sizePx: number) => {
    const lines = estimateLineCount(displayedContent, innerWidthPx, sizePx)
    const lh = effectiveLineHeight(s, lines)
    const pad = textMetricsPaddingPx(sizePx)
    return lines * sizePx * lh + pad.top + pad.bottom
  }

  while (px > minPx && heightFor(px) > innerHeightPx + 0.5) {
    px -= 0.25
  }
  return px
}

export function textInnerPaddingPx(
  el: SlideElement,
  s: ElementStyle,
  fontSizePx: number
): { top: number; right: number; bottom: number; left: number } {
  const isBar = el.type === 'bar'
  const isImage = el.type === 'image'
  const isChart = el.type === 'chart'
  const isIcon = el.type === 'icon'
  if (isBar || isImage || isChart || isIcon) {
    return { top: 0, right: 0, bottom: 0, left: 0 }
  }

  const metrics = textMetricsPaddingPx(fontSizePx)
  return {
    top: s.padTop != null ? s.padTop * CANVAS_PX_PER_IN : metrics.top,
    right: s.padRight != null ? s.padRight * CANVAS_PX_PER_IN : 0,
    bottom: s.padBottom != null ? s.padBottom * CANVAS_PX_PER_IN : metrics.bottom,
    left: s.padLeft != null ? s.padLeft * CANVAS_PX_PER_IN : 0,
  }
}

export function textBodyStyle(
  el: SlideElement,
  s: ElementStyle = el.style ?? {},
  innerPad?: { top: number; right: number; bottom: number; left: number }
): CSSProperties {
  const valign = effectiveTextValign(el, s)
  const justify =
    valign === 'top' ? 'flex-start' : valign === 'bottom' ? 'flex-end' : 'center'
  const align = s.align ?? (el.type === 'chip' ? 'center' : 'left')
  const alignItems =
    align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'stretch'

  return {
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: justify,
    alignItems,
    overflow: 'visible',
    boxSizing: 'border-box',
    ...(innerPad
      ? {
          padding: `${innerPad.top}px ${innerPad.right}px ${innerPad.bottom}px ${innerPad.left}px`,
        }
      : {}),
  }
}

export function textSpanStyle(
  el: SlideElement,
  s: ElementStyle = el.style ?? {},
  opts?: { innerWidthPx?: number; innerHeightPx?: number; displayedContent?: string }
): CSSProperties {
  const align = s.align ?? (el.type === 'chip' ? 'center' : 'left')
  const centered = align === 'center' || align === 'right'
  const displayed = opts?.displayedContent ?? el.content ?? ''
  const innerW = opts?.innerWidthPx ?? 0
  const innerH = opts?.innerHeightPx ?? 0

  const fontSizePx =
    innerW > 0 && innerH > 0
      ? fittedCanvasFontSizePx(s, innerW, innerH, displayed)
      : canvasFontSizePx(s.fontSize ?? 12)

  const lineCount = Math.max(1, displayed.split('\n').length)
  const multiLine = lineCount >= 2 || displayed.split(/\s+/).length >= 4

  return {
    fontSize: fontSizePx,
    fontWeight: s.fontWeight ?? (s.bold ? 700 : 400),
    fontStyle: s.italic ? 'italic' : 'normal',
    letterSpacing: s.charSpacing ? `${s.charSpacing * 0.06}em` : undefined,
    width: centered ? 'auto' : '100%',
    maxWidth: '100%',
    whiteSpace: 'pre-wrap',
    wordBreak: 'normal',
    overflowWrap: 'break-word',
    textWrap: multiLine ? 'balance' : undefined,
    lineHeight: effectiveLineHeight(s, lineCount),
    textAlign: align,
    pointerEvents: 'none',
    display: 'block',
  }
}
