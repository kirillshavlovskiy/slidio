import JSZip from 'jszip'
import { SlideData, SlideElement, ElementStyle, SlideGradient } from '@/lib/types'

// PowerPoint stores geometry in EMUs (English Metric Units). 914400 EMU = 1 inch.
const EMU_PER_INCH = 914400
// The editor canvas is a fixed 10 × 7.5 in (4:3) space.
const EDITOR_W_IN = 10
const EDITOR_H_IN = 7.5

export interface ImportResult {
  slides: SlideData[]
  warnings: string[]
}

let importSeq = 0
function uid(prefix: string): string {
  importSeq += 1
  return `${prefix}-${Date.now().toString(36)}-${importSeq}`
}

function emuToIn(emu: number): number {
  return emu / EMU_PER_INCH
}

/** Relative luminance (0–1) of an RRGGBB hex, used to pick contrasting text. */
function luminance(hex: string): number {
  const h = hex.replace('#', '')
  if (h.length !== 6) return 1
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const MEDIA_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  tiff: 'image/tiff',
}

/** Decode XML entities that appear in <a:t> text runs. */
function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
}

/** Pull the text out of one shape's <p:txBody>, paragraphs joined by newlines. */
function extractShapeText(xml: string): string {
  const body = xml.match(/<p:txBody>([\s\S]*?)<\/p:txBody>/)
  if (!body) return ''
  const paras = Array.from(body[1].matchAll(/<a:p>([\s\S]*?)<\/a:p>/g))
  const lines = paras.map(p => {
    const runs = Array.from(p[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g))
    return runs.map(r => decodeXml(r[1])).join('')
  })
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function firstAlign(xml: string): ElementStyle['align'] | undefined {
  const m = xml.match(/<a:pPr[^>]*\salgn="(\w+)"/)
  if (!m) return undefined
  if (m[1] === 'ctr') return 'center'
  if (m[1] === 'r') return 'right'
  if (m[1] === 'l' || m[1] === 'just') return 'left'
  return undefined
}

function bodyAnchor(xml: string): ElementStyle['valign'] | undefined {
  const m = xml.match(/<a:bodyPr[^>]*\sanchor="(\w+)"/)
  if (!m) return undefined
  if (m[1] === 'ctr') return 'middle'
  if (m[1] === 'b') return 'bottom'
  if (m[1] === 't') return 'top'
  return undefined
}

/** First explicit srgbClr inside a solidFill within the given chunk of XML. */
function firstSolidFill(xml: string): string | undefined {
  const m = xml.match(/<a:solidFill>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"/)
  return m ? m[1].toUpperCase() : undefined
}

/**
 * Parse a PowerPoint <a:gradFill> into a SlideGradient. Only explicit srgbClr
 * stops are supported (theme/scheme colors are skipped). Returns null when
 * fewer than two usable color stops are present.
 */
function parseGradient(xml: string): SlideGradient | null {
  const grad = xml.match(/<a:gradFill[\s\S]*?<\/a:gradFill>/)
  if (!grad) return null
  const block = grad[0]
  const stops = Array.from(block.matchAll(/<a:gs\b[^>]*\bpos="(\d+)"[\s\S]*?<\/a:gs>/g))
    .map(m => {
      const col = m[0].match(/<a:srgbClr val="([0-9A-Fa-f]{6})"/)
      return col ? { pos: parseInt(m[1]), hex: col[1].toUpperCase() } : null
    })
    .filter((s): s is { pos: number; hex: string } => s !== null)
  if (stops.length < 2) return null
  stops.sort((a, b) => a.pos - b.pos)
  const from = stops[0].hex
  const to = stops[stops.length - 1].hex
  const via = stops.length >= 3 ? stops[Math.floor(stops.length / 2)].hex : undefined

  // Radial when a path element is present; otherwise linear with an angle.
  if (/<a:path\b/.test(block)) {
    return { type: 'radial', from, to, ...(via ? { via } : {}) }
  }
  const angMatch = block.match(/<a:lin[^>]*\bang="(-?\d+)"/)
  // PPTX angle: 60000ths of a degree, clockwise from East. CSS: clockwise from
  // North (0deg = up). Convert with +90°.
  const pptxDeg = angMatch ? parseInt(angMatch[1]) / 60000 : 0
  const angle = Math.round((((pptxDeg + 90) % 360) + 360) % 360)
  return { type: 'linear', angle, from, to, ...(via ? { via } : {}) }
}

interface Xfrm {
  x: number
  y: number
  w: number
  h: number
}

function parseXfrm(xml: string): Xfrm | null {
  const off = xml.match(/<a:off x="(-?\d+)" y="(-?\d+)"/)
  const ext = xml.match(/<a:ext cx="(\d+)" cy="(\d+)"/)
  if (!off || !ext) return null
  return {
    x: emuToIn(parseInt(off[1])),
    y: emuToIn(parseInt(off[2])),
    w: emuToIn(parseInt(ext[1])),
    h: emuToIn(parseInt(ext[2])),
  }
}

interface Transform {
  scale: number
  offX: number
  offY: number
}

/** Map a source (inches) rect into the editor's 10×7.5 box, preserving aspect. */
function applyTransform(r: Xfrm, t: Transform): Xfrm {
  return {
    x: round2(t.offX + r.x * t.scale),
    y: round2(t.offY + r.y * t.scale),
    w: round2(Math.max(0.05, r.w * t.scale)),
    h: round2(Math.max(0.05, r.h * t.scale)),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Read slide rels: rId -> media file path inside the zip. */
async function readSlideRels(
  zip: JSZip,
  slidePath: string
): Promise<Record<string, string>> {
  const name = slidePath.split('/').pop()
  const relsPath = `ppt/slides/_rels/${name}.rels`
  const file = zip.file(relsPath)
  const map: Record<string, string> = {}
  if (!file) return map
  const xml = await file.async('text')
  for (const m of xml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    let target = m[2]
    // Targets are usually relative to ppt/slides, e.g. "../media/image1.png".
    target = target.replace(/^\.\.\//, 'ppt/').replace(/^\//, '')
    if (!target.startsWith('ppt/')) target = `ppt/${target.replace(/^ppt\//, '')}`
    map[m[1]] = target
  }
  return map
}

async function mediaDataUrl(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path)
  if (!file) return null
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const mime = MEDIA_MIME[ext]
  if (!mime) return null // skip emf/wmf and other non-web formats
  const b64 = await file.async('base64')
  return `data:${mime};base64,${b64}`
}

/** Remove grouped-shape blocks so we only place top-level, absolutely-positioned shapes. */
function stripGroups(spTree: string): string {
  let out = spTree
  let prev = ''
  while (out !== prev) {
    prev = out
    out = out.replace(/<p:grpSp>[\s\S]*?<\/p:grpSp>/g, '')
  }
  return out
}

async function parseSlide(
  zip: JSZip,
  slidePath: string,
  transform: Transform,
  warnings: string[]
): Promise<SlideData> {
  const xml = await zip.file(slidePath)!.async('text')
  const rels = await readSlideRels(zip, slidePath)

  // Slide background: gradient (preferred) or explicit solid fill, else white.
  const bgBlock = xml.match(/<p:bg>([\s\S]*?)<\/p:bg>/)
  const bgGradient = bgBlock ? parseGradient(bgBlock[1]) : null
  const bg = bgGradient?.from || (bgBlock && firstSolidFill(bgBlock[1])) || 'FFFFFF'
  const bgLum = luminance(bg)

  const treeMatch = xml.match(/<p:spTree>([\s\S]*?)<\/p:spTree>/)
  const tree = treeMatch ? stripGroups(treeMatch[1]) : ''
  const elements: SlideElement[] = []
  let skippedFrames = 0

  // Walk shapes (p:sp) and pictures (p:pic) in document order to keep z-order.
  const blocks = Array.from(tree.matchAll(/<p:(sp|pic)\b[\s\S]*?<\/p:\1>/g))
  for (const block of blocks) {
    const kind = block[1]
    const shapeXml = block[0]
    const xfrm = parseXfrm(shapeXml)
    if (!xfrm) continue
    const rect = applyTransform(xfrm, transform)

    if (kind === 'pic') {
      const embed = shapeXml.match(/<a:blip[^>]*r:embed="([^"]+)"/)
      const path = embed ? rels[embed[1]] : undefined
      const src = path ? await mediaDataUrl(zip, path) : null
      if (!src) {
        skippedFrames++
        continue
      }
      elements.push({
        id: uid('img'),
        type: 'image',
        src,
        ...rect,
        style: { objectFit: 'contain' },
      })
      continue
    }

    // p:sp — text and/or filled shape. Strip any <a:ln> (border) blocks first so
    // a gradient border isn't mistaken for a gradient fill.
    const text = extractShapeText(shapeXml)
    const spPr = shapeXml.match(/<p:spPr>([\s\S]*?)<\/p:spPr>/)
    const spPrFill = spPr ? spPr[1].replace(/<a:ln>[\s\S]*?<\/a:ln>/g, '') : ''
    const fill = spPrFill ? firstSolidFill(spPrFill) : undefined
    const fillGradient = spPrFill ? parseGradient(spPrFill) : null

    if (text) {
      const rPrFull = shapeXml.match(/<a:rPr[\s\S]*?<\/a:rPr>/) // run props with nested fill
      const szMatch = shapeXml.match(/<a:rPr[^>]*\ssz="(\d+)"/)
      const bold = /<a:rPr[^>]*\sb="1"/.test(shapeXml)
      const italic = /<a:rPr[^>]*\si="1"/.test(shapeXml)
      const face = shapeXml.match(/<a:latin[^>]*typeface="([^"]+)"/)
      const runColor = rPrFull ? firstSolidFill(rPrFull[0]) : undefined
      const fontSize = szMatch
        ? Math.max(6, Math.round((parseInt(szMatch[1]) / 100) * transform.scale))
        : Math.round(18 * transform.scale)
      const color = runColor ?? (bgLum < 0.5 ? 'FFFFFF' : '111827')
      const style: ElementStyle = { fontSize, color }
      if (bold) style.bold = true
      if (italic) style.italic = true
      if (face && !face[1].startsWith('+')) style.fontFace = face[1]
      const align = firstAlign(shapeXml)
      if (align) style.align = align
      const valign = bodyAnchor(shapeXml)
      if (valign) style.valign = valign
      if (fillGradient) {
        style.bg = fillGradient.from
        style.bgGradient = fillGradient
      } else if (fill && fill.toUpperCase() !== bg.toUpperCase()) {
        style.bg = fill
      }
      elements.push({ id: uid('txt'), type: 'text', content: text, ...rect, style })
    } else if (fillGradient) {
      elements.push({
        id: uid('rect'),
        type: 'rect',
        ...rect,
        style: { bg: fillGradient.from, bgGradient: fillGradient },
      })
    } else if (fill) {
      elements.push({ id: uid('rect'), type: 'rect', ...rect, style: { bg: fill } })
    }
  }

  if (skippedFrames > 0) {
    warnings.push(`A slide had ${skippedFrames} image(s) in an unsupported format (skipped).`)
  }

  return { id: uid('slide'), bg, ...(bgGradient ? { bgGradient } : {}), elements }
}

/** Parse a .pptx file (as a Buffer) into editable SlideData[]. */
export async function importPptx(buffer: Buffer): Promise<ImportResult> {
  const warnings: string[] = []
  const zip = await JSZip.loadAsync(buffer)

  // Source slide size from presentation.xml (EMU). Default to 4:3 if absent.
  let srcW = EDITOR_W_IN
  let srcH = EDITOR_H_IN
  const presFile = zip.file('ppt/presentation.xml')
  if (presFile) {
    const presXml = await presFile.async('text')
    const sz = presXml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/)
    if (sz) {
      srcW = emuToIn(parseInt(sz[1]))
      srcH = emuToIn(parseInt(sz[2]))
    }
  }

  // Uniformly scale + center the source slide into the editor's 10×7.5 box.
  const scale = Math.min(EDITOR_W_IN / srcW, EDITOR_H_IN / srcH)
  const transform: Transform = {
    scale,
    offX: round2((EDITOR_W_IN - srcW * scale) / 2),
    offY: round2((EDITOR_H_IN - srcH * scale) / 2),
  }
  if (Math.abs(srcW / srcH - EDITOR_W_IN / EDITOR_H_IN) > 0.05) {
    warnings.push(
      'Source slides are not 4:3 — they were scaled to fit the 10×7.5in editor canvas.'
    )
  }

  const slidePaths = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/(\d+)\.xml$/)![1])
      const nb = parseInt(b.match(/(\d+)\.xml$/)![1])
      return na - nb
    })

  if (slidePaths.length === 0) {
    throw new Error('No slides found in the .pptx file.')
  }

  const slides: SlideData[] = []
  for (const path of slidePaths) {
    slides.push(await parseSlide(zip, path, transform, warnings))
  }

  // De-duplicate warnings.
  return { slides, warnings: Array.from(new Set(warnings)) }
}
