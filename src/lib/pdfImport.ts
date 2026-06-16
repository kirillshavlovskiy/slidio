import { SlideData, SlideElement, ElementStyle } from '@/lib/types'
import type { ImportResult } from '@/lib/pptxImport'

// The editor canvas is a fixed 10 × 7.5 in (4:3) space.
const EDITOR_W_IN = 10
const EDITOR_H_IN = 7.5
// PDF user space is in points (72 per inch).
const PT_PER_IN = 72
// Target raster width (px) per page — used for background sampling and the
// image fallback on pages that have no extractable text layer.
const TARGET_PX_WIDTH = 1400
// Below this many text characters a page is treated as image-only (e.g. scanned).
const MIN_TEXT_CHARS = 3

let seq = 0
function uid(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase()
}

function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

interface Transform {
  scale: number
  offX: number
  offY: number
}

/** One raw text fragment positioned in editor inches. */
interface Frag {
  str: string
  x: number // left, inches
  yTop: number // top, inches
  w: number // inches
  fontPt: number // font size in pt (already scaled to editor)
}

/** Group fragments that sit on the same baseline into single-line text elements. */
function fragsToElements(frags: Frag[], color: string): SlideElement[] {
  if (frags.length === 0) return []
  // Sort top-to-bottom, then left-to-right.
  frags.sort((a, b) => (Math.abs(a.yTop - b.yTop) > 0.05 ? a.yTop - b.yTop : a.x - b.x))

  const lines: Frag[][] = []
  for (const f of frags) {
    const last = lines[lines.length - 1]
    const lastFrag = last?.[last.length - 1]
    const threshold = Math.max(0.04, (f.fontPt / PT_PER_IN) * 0.6)
    if (lastFrag && Math.abs(lastFrag.yTop - f.yTop) <= threshold) {
      last.push(f)
    } else {
      lines.push([f])
    }
  }

  const elements: SlideElement[] = []
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x)
    // Concatenate, inserting a space when fragments don't already abut.
    let content = ''
    let prevRight: number | null = null
    for (const f of line) {
      if (prevRight !== null) {
        const gap = f.x - prevRight
        const wantsSpace = gap > (f.fontPt / PT_PER_IN) * 0.25
        if (wantsSpace && content && !/\s$/.test(content) && !/^\s/.test(f.str)) content += ' '
      }
      content += f.str
      prevRight = f.x + f.w
    }
    content = content.replace(/\s+/g, ' ').trim()
    if (!content) continue

    const minX = Math.min(...line.map(f => f.x))
    const minY = Math.min(...line.map(f => f.yTop))
    const maxRight = Math.max(...line.map(f => f.x + f.w))
    const fontPt = Math.round(line.reduce((s, f) => s + f.fontPt, 0) / line.length)
    const lineH = round2(Math.max(0.18, (fontPt / PT_PER_IN) * 1.35))

    elements.push({
      id: uid('txt'),
      type: 'text',
      content,
      x: round2(Math.max(0, minX)),
      y: round2(Math.max(0, minY)),
      w: round2(Math.max(0.3, maxRight - minX + 0.12)),
      h: lineH,
      style: { fontSize: Math.max(6, fontPt), color, valign: 'top' } as ElementStyle,
    })
  }
  return elements
}

/** Sample the rendered page's corners/center to guess its background color. */
function sampleBackground(ctx: CanvasRenderingContext2D, w: number, h: number): {
  hex: string
  lum: number
} {
  const pts: [number, number][] = [
    [2, 2],
    [w - 3, 2],
    [2, h - 3],
    [w - 3, h - 3],
    [Math.floor(w / 2), 2],
  ]
  let r = 0
  let g = 0
  let b = 0
  for (const [px, py] of pts) {
    const d = ctx.getImageData(px, py, 1, 1).data
    r += d[0]
    g += d[1]
    b += d[2]
  }
  r /= pts.length
  g /= pts.length
  b /= pts.length
  return { hex: `${toHex(r)}${toHex(g)}${toHex(b)}`, lum: luminance(r, g, b) }
}

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist')
  // Serve the worker from /public (copied there by scripts/copy-pdf-worker.mjs
  // in the prebuild step). Using a static path avoids webpack trying to bundle
  // and minify the worker .mjs, which breaks the production build under Terser.
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
  return pdfjs
}

export interface PageBackground {
  hex: string
  lum: number
}

/**
 * Render each PDF page in the browser and sample its background colour.
 * Adobe's PDF→PPTX export keeps editable text but discards the visual
 * backgrounds (every slide comes back white), so we recover an approximate
 * solid background per page to restore readability (e.g. white text that was
 * designed for a dark background). Returns one entry per page, in order.
 */
export async function samplePdfPageBackgrounds(file: File): Promise<PageBackground[]> {
  const pdfjs = await loadPdfjs()
  const data = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data }).promise
  const out: PageBackground[] = []
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const base = page.getViewport({ scale: 1 })
    const renderScale = TARGET_PX_WIDTH / base.width
    const viewport = page.getViewport({ scale: renderScale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      out.push({ hex: 'FFFFFF', lum: 1 })
      continue
    }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    out.push(sampleBackground(ctx, canvas.width, canvas.height))
  }
  return out
}

/**
 * Render a PDF (in the browser) into editable slides. Pages with a real text
 * layer become editable text elements positioned to match the original; pages
 * without text (e.g. scanned) fall back to a single full-page image.
 */
export async function importPdf(file: File): Promise<ImportResult> {
  const pdfjs = await loadPdfjs()

  const data = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data }).promise
  const slides: SlideData[] = []
  const warnings: string[] = []
  let imageFallbackPages = 0

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const base = page.getViewport({ scale: 1 })

    // Source page size in inches; fit + center into the editor's 10×7.5 box.
    const srcWin = base.width / PT_PER_IN
    const srcHin = base.height / PT_PER_IN
    const fit = Math.min(EDITOR_W_IN / srcWin, EDITOR_H_IN / srcHin)
    const transform: Transform = {
      scale: fit,
      offX: round2((EDITOR_W_IN - srcWin * fit) / 2),
      offY: round2((EDITOR_H_IN - srcHin * fit) / 2),
    }

    // Raster the page (for background sampling + possible image fallback).
    const renderScale = TARGET_PX_WIDTH / base.width
    const viewport = page.getViewport({ scale: renderScale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    let bgHex = 'FFFFFF'
    let bgLum = 1
    if (ctx) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      const bg = sampleBackground(ctx, canvas.width, canvas.height)
      bgHex = bg.hex
      bgLum = bg.lum
    }
    const textColor = bgLum < 0.5 ? 'FFFFFF' : '111827'

    // Pull the text layer and map each fragment into editor inches.
    let frags: Frag[] = []
    try {
      const content = await page.getTextContent()
      const sv = page.getViewport({ scale: 1 }) // identity-scale viewport transform
      for (const item of content.items) {
        if (!('str' in item)) continue
        const str = item.str
        if (!str || !str.trim()) continue
        // Map text-space matrix into top-left viewport coords (points).
        const m = pdfjs.Util.transform(sv.transform, item.transform)
        const fontHeightPt = Math.hypot(m[2], m[3]) || item.height || 12
        const leftPt = m[4]
        const topPt = m[5] - fontHeightPt
        frags.push({
          str,
          x: transform.offX + (leftPt / PT_PER_IN) * fit,
          yTop: transform.offY + (topPt / PT_PER_IN) * fit,
          w: ((item.width || str.length * fontHeightPt * 0.5) / PT_PER_IN) * fit,
          fontPt: fontHeightPt * fit,
        })
      }
    } catch {
      frags = []
    }

    const totalChars = frags.reduce((s, f) => s + f.str.trim().length, 0)

    if (totalChars >= MIN_TEXT_CHARS) {
      const elements = fragsToElements(frags, textColor)
      slides.push({ id: uid('slide'), bg: bgHex, elements })
    } else {
      // No usable text layer → keep the page as a full-slide image.
      imageFallbackPages++
      const src = canvas.toDataURL('image/png')
      const pageAspect = base.width / base.height
      const boxAspect = EDITOR_W_IN / EDITOR_H_IN
      let w = EDITOR_W_IN
      let h = EDITOR_H_IN
      if (pageAspect > boxAspect) h = EDITOR_W_IN / pageAspect
      else w = EDITOR_H_IN * pageAspect
      slides.push({
        id: uid('slide'),
        bg: 'FFFFFF',
        elements: [
          {
            id: uid('img'),
            type: 'image',
            src,
            x: round2((EDITOR_W_IN - w) / 2),
            y: round2((EDITOR_H_IN - h) / 2),
            w: round2(w),
            h: round2(h),
            style: { objectFit: 'contain' },
          },
        ],
      })
    }
  }

  if (slides.length === 0) throw new Error('No pages found in the PDF.')
  warnings.push(
    'PDF text was extracted into editable text boxes. Vector graphics, charts and exact fonts/colors are approximate — ask the AI to refine a slide if needed.'
  )
  if (imageFallbackPages > 0) {
    warnings.push(
      `${imageFallbackPages} page(s) had no text layer (e.g. scanned) and were imported as images.`
    )
  }
  return { slides, warnings }
}
