import { jsPDF } from 'jspdf'
import { SlideData, SlideElement, ElementStyle } from './types'
import { elementFillHex, elementTextHex } from './elementStyle'

/**
 * PDF export. The primary path rasterises each slide from the same canvas DOM
 * the editor uses (via html-to-image in the app shell) so fonts, gradients,
 * charts and layout match what you see. {@link buildPdfFromImages} assembles those
 * PNGs into a multi-page PDF.
 *
 * {@link buildPdf} is kept as a lightweight vector fallback (Helvetica-only, no
 * charts/gradients) for cases where raster capture isn't available.
 */

const SLIDE_W_IN = 10
const SLIDE_H_IN = 7.5
const PX_PER_IN = 96
const PT_PER_IN = 72
/** SlideCanvas renders stored pt sizes at ×1.2 px — mirror that in vector export. */
const CANVAS_FONT_SCALE = 1.2

/** Convert a hex color (with or without leading #) to an [r,g,b] triple. */
function hexToRgb(hex?: string): [number, number, number] | null {
  if (!hex) return null
  const h = hex.replace('#', '').trim()
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  if (full.length !== 6) return null
  const n = parseInt(full, 16)
  if (Number.isNaN(n)) return null
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function fontStyleOf(st: ElementStyle): 'normal' | 'bold' | 'italic' | 'bolditalic' {
  const bold = st.bold || (typeof st.fontWeight === 'number' && st.fontWeight >= 600)
  if (bold && st.italic) return 'bolditalic'
  if (bold) return 'bold'
  if (st.italic) return 'italic'
  return 'normal'
}

/** Map design-system / web font names to jsPDF's built-in families. */
function pdfFontFamily(fontFace?: string): 'helvetica' | 'times' | 'courier' {
  const face = (fontFace || '').toLowerCase()
  if (face.includes('courier') || face.includes('mono')) return 'courier'
  if (
    face.includes('georgia') ||
    face.includes('times') ||
    face.includes('palatino') ||
    face.includes('garamond')
  ) {
    return 'times'
  }
  return 'helvetica'
}

function setOpacity(doc: jsPDF, st: ElementStyle) {
  const o = typeof st.opacity === 'number' ? Math.max(0, Math.min(100, st.opacity)) / 100 : 1
  doc.setGState(doc.GState({ opacity: o }))
}

function resetOpacity(doc: jsPDF) {
  doc.setGState(doc.GState({ opacity: 1 }))
}

function applyBorder(doc: jsPDF, st: ElementStyle): boolean {
  if (!st.borderWidth || st.borderWidth <= 0 || !st.borderColor) return false
  const rgb = hexToRgb(st.borderColor)
  if (!rgb) return false
  doc.setDrawColor(rgb[0], rgb[1], rgb[2])
  doc.setLineWidth(st.borderWidth / PX_PER_IN)
  if (st.borderStyle === 'dashed') doc.setLineDashPattern([0.05, 0.04], 0)
  else if (st.borderStyle === 'dotted') doc.setLineDashPattern([0.012, 0.03], 0)
  else doc.setLineDashPattern([], 0)
  return true
}

function drawBox(doc: jsPDF, el: SlideElement, hasFill: boolean, hasBorder: boolean) {
  const style = hasFill && hasBorder ? 'FD' : hasFill ? 'F' : hasBorder ? 'S' : null
  if (!style) return
  const radiusIn = el.style.borderRadius && el.style.borderRadius > 0 ? el.style.borderRadius / PX_PER_IN : 0
  if (radiusIn > 0) {
    doc.roundedRect(el.x, el.y, el.w, el.h, radiusIn, radiusIn, style)
  } else {
    doc.rect(el.x, el.y, el.w, el.h, style)
  }
}

function drawText(doc: jsPDF, el: SlideElement) {
  if (!el.content?.trim()) return
  const st = el.style
  const rgb = hexToRgb(elementTextHex(el)) || [255, 255, 255]
  const sizePt = (st.fontSize || (el.type === 'text' ? 12 : 10)) * CANVAS_FONT_SCALE

  doc.setFont(pdfFontFamily(st.fontFace), fontStyleOf(st))
  doc.setFontSize(sizePt)
  doc.setTextColor(rgb[0], rgb[1], rgb[2])
  if (typeof st.charSpacing === 'number') doc.setCharSpace(st.charSpacing / PT_PER_IN)

  // Inner box after inch padding.
  const padL = st.padLeft || 0
  const padR = st.padRight || 0
  const padT = st.padTop || 0
  const padB = st.padBottom || 0
  const innerX = el.x + padL
  const innerY = el.y + padT
  const innerW = Math.max(0.01, el.w - padL - padR)
  const innerH = Math.max(0.01, el.h - padT - padB)

  // Honour explicit newlines (lists, multi-line titles) then wrap each paragraph.
  const paragraphs = el.content.split('\n')
  const lines: string[] = []
  for (const para of paragraphs) {
    const wrapped = doc.splitTextToSize(para, innerW) as string[]
    if (wrapped.length === 0) lines.push('')
    else lines.push(...wrapped)
  }
  const lineH = (sizePt / PT_PER_IN) * (st.lineHeight || 1.25)
  const blockH = lines.length * lineH

  const align = st.align || (el.type === 'text' ? 'left' : 'center')
  const textX = align === 'center' ? innerX + innerW / 2 : align === 'right' ? innerX + innerW : innerX

  const valign = st.valign || 'middle'
  let cursorY =
    valign === 'top' ? innerY : valign === 'bottom' ? innerY + innerH - blockH : innerY + (innerH - blockH) / 2
  if (cursorY < innerY) cursorY = innerY

  for (const line of lines) {
    if (cursorY > innerY + innerH + lineH * 0.25) break
    doc.text(line, textX, cursorY, { align, baseline: 'top', maxWidth: innerW })
    cursorY += lineH
  }
  doc.setCharSpace(0)
}

function drawImage(doc: jsPDF, el: SlideElement) {
  const src = el.src
  // Only embeddable data URLs are placed; named/remote refs are skipped (same
  // policy as the PPTX export).
  if (!src || !/^data:image\//i.test(src)) return
  const fmt = /^data:image\/png/i.test(src) ? 'PNG' : /^data:image\/(jpe?g)/i.test(src) ? 'JPEG' : 'PNG'
  try {
    doc.addImage(src, fmt, el.x, el.y, el.w, el.h, undefined, 'FAST')
  } catch {
    /* unsupported image payload — skip rather than abort the whole export */
  }
}

export function buildPdf(slides: SlideData[]): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: [SLIDE_W_IN, SLIDE_H_IN] })

  slides.forEach((slide, idx) => {
    if (idx > 0) doc.addPage([SLIDE_W_IN, SLIDE_H_IN], 'landscape')

    const bg = hexToRgb(slide.bg) || [13, 27, 42]
    doc.setFillColor(bg[0], bg[1], bg[2])
    doc.rect(0, 0, SLIDE_W_IN, SLIDE_H_IN, 'F')

    for (const el of slide.elements) {
      setOpacity(doc, el.style)

      if (el.type === 'image') {
        drawImage(doc, el)
        resetOpacity(doc)
        continue
      }

      const fillHex = el.type === 'text' ? el.style.bg : elementFillHex(el)
      const fillRgb = hexToRgb(fillHex)
      if (fillRgb) doc.setFillColor(fillRgb[0], fillRgb[1], fillRgb[2])
      const hasBorder = applyBorder(doc, el.style)
      drawBox(doc, el, !!fillRgb, hasBorder)
      doc.setLineDashPattern([], 0)

      if (el.type !== 'bar' && el.type !== 'chart') drawText(doc, el)

      resetOpacity(doc)
    }
  })

  return doc
}

/** Assemble raster slide PNGs (from canvas capture) into a multi-page PDF. */
export function buildPdfFromImages(images: string[]): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: [SLIDE_W_IN, SLIDE_H_IN] })
  images.forEach((src, idx) => {
    if (idx > 0) doc.addPage([SLIDE_W_IN, SLIDE_H_IN], 'landscape')
    if (!src) return
    try {
      doc.addImage(src, 'PNG', 0, 0, SLIDE_W_IN, SLIDE_H_IN, undefined, 'FAST')
    } catch {
      /* skip a bad page rather than abort the whole export */
    }
  })
  return doc
}

export function downloadPdfFromImages(images: string[], filename = 'presentation.pdf') {
  buildPdfFromImages(images).save(filename)
}

export function downloadPdf(slides: SlideData[], filename = 'presentation.pdf') {
  buildPdf(slides).save(filename)
}
