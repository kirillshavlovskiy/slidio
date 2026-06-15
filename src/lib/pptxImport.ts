import JSZip from 'jszip'
import { SlideData, SlideElement, ElementStyle, SlideGradient } from '@/lib/types'
import {
  ColorContext,
  loadColorContext,
  resolveColorElement,
  resolveSolidFill,
} from '@/lib/pptxColor'

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

function toAlpha(n: number, upper: boolean): string {
  let s = ''
  let x = n
  while (x > 0) {
    const rem = (x - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    x = Math.floor((x - 1) / 26)
  }
  return upper ? s : s.toLowerCase()
}

function toRoman(n: number, upper: boolean): string {
  const table: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ]
  let x = n
  let s = ''
  for (const [v, sym] of table) {
    while (x >= v) {
      s += sym
      x -= v
    }
  }
  return upper ? s : s.toLowerCase()
}

/** Format an auto-number marker for a given <a:buAutoNum type> and counter. */
function autoNumMarker(type: string, n: number): string {
  if (type.startsWith('alpha')) {
    const upper = type.includes('Uc')
    const letter = toAlpha(n, upper)
    if (type.includes('ParenBoth')) return `(${letter})`
    if (type.includes('ParenR')) return `${letter})`
    return `${letter}.`
  }
  if (type.startsWith('roman')) {
    const upper = type.includes('Uc')
    const rom = toRoman(n, upper)
    if (type.includes('ParenBoth')) return `(${rom})`
    if (type.includes('ParenR')) return `${rom})`
    return `${rom}.`
  }
  // arabic*
  if (type.includes('ParenBoth')) return `(${n})`
  if (type.includes('ParenR')) return `${n})`
  if (type.includes('Plain')) return `${n}`
  return `${n}.`
}

// Symbol-font bullet glyphs (Wingdings/Symbol private codepoints) render as
// garbage in a normal font, so normalize the common ones to a real bullet.
function normalizeBulletChar(char: string, font: string | undefined): string {
  const symbolFont = !!font && /wingdings|webdings|symbol/i.test(font)
  if (symbolFont) return '•'
  const cp = char.codePointAt(0) ?? 0
  if (cp < 0x20 || (cp >= 0xf000 && cp <= 0xf0ff)) return '•'
  return char
}

// Text that already begins with its own bullet/number (common in PDF→PPTX
// output where the marker is baked into the run text) shouldn't get a second.
const ALREADY_BULLETED = /^\s*([•◦▪▸‣·*–—-]|\(?\d+[.)]|\(?[A-Za-z][.)])\s+/

/**
 * Pull the text out of one shape's <p:txBody>, preserving list structure.
 * Each <a:p> becomes a line; bulleted (<a:buChar>) and numbered (<a:buAutoNum>)
 * paragraphs are prefixed with a marker, and indent level (lvl) adds leading
 * spaces. `defaultBullet` adds a bullet to body-placeholder paragraphs that
 * inherit one from the master list style without declaring it explicitly.
 */
function extractShapeText(xml: string, defaultBullet = false): string {
  const body = xml.match(/<p:txBody>([\s\S]*?)<\/p:txBody>/)
  if (!body) return ''
  const paras = Array.from(body[1].matchAll(/<a:p>([\s\S]*?)<\/a:p>/g))
  // Auto-number counters keyed by indent level.
  const counters: Record<number, number> = {}
  const lines = paras.map(p => {
    const pBody = p[1]
    const runs = Array.from(pBody.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g))
    const text = runs.map(r => decodeXml(r[1])).join('')
    const pPr =
      pBody.match(/<a:pPr\b[^>]*\/>/)?.[0] ??
      pBody.match(/<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/)?.[0] ??
      ''
    const lvl = parseInt(pPr.match(/\blvl="(\d+)"/)?.[1] ?? '0')
    const indent = '  '.repeat(lvl)

    if (!text.trim()) {
      // Blank paragraph — reset deeper counters and emit an empty line.
      for (const k of Object.keys(counters)) if (Number(k) >= lvl) delete counters[Number(k)]
      return ''
    }
    if (ALREADY_BULLETED.test(text)) return indent + text

    const autoNum = pPr.match(/<a:buAutoNum\b[^>]*>/)?.[0]
    const buChar = pPr.match(/<a:buChar\b[^>]*\bchar="([^"]*)"/)
    const noBullet = /<a:buNone\b/.test(pPr)

    if (autoNum) {
      const type = autoNum.match(/\btype="([^"]+)"/)?.[1] ?? 'arabicPeriod'
      const startAt = parseInt(autoNum.match(/\bstartAt="(\d+)"/)?.[1] ?? '')
      counters[lvl] = (counters[lvl] ?? (Number.isFinite(startAt) ? startAt - 1 : 0)) + 1
      for (const k of Object.keys(counters)) if (Number(k) > lvl) delete counters[Number(k)]
      return `${indent}${autoNumMarker(type, counters[lvl])} ${text}`
    }

    // Any non-numbered paragraph breaks the numbering at this level.
    delete counters[lvl]
    if (buChar) {
      const font = pPr.match(/<a:buFont\b[^>]*typeface="([^"]+)"/)?.[1]
      return `${indent}${normalizeBulletChar(decodeXml(buChar[1]), font)} ${text}`
    }
    if (!noBullet && defaultBullet) return `${indent}• ${text}`
    return indent + text
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

/**
 * Parse a PowerPoint <a:gradFill> into a SlideGradient. Stop colors are
 * resolved through the theme so scheme/system colors (not just explicit
 * srgbClr) are honored. Returns null when fewer than two usable stops exist.
 */
function parseGradient(xml: string, ctx: ColorContext): SlideGradient | null {
  const grad = xml.match(/<a:gradFill[\s\S]*?<\/a:gradFill>/)
  if (!grad) return null
  const block = grad[0]
  const stops = Array.from(block.matchAll(/<a:gs\b[^>]*\bpos="(\d+)"[\s\S]*?<\/a:gs>/g))
    .map(m => {
      const hex = resolveColorElement(m[0], ctx)
      return hex ? { pos: parseInt(m[1]), hex } : null
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

// A group's coordinate mapping (child space → absolute slide space, in inches).
// Axis-aligned scale + translate is all PPTX groups need (no rotation here).
interface GroupTransform {
  sx: number
  sy: number
  tx: number
  ty: number
}
const IDENTITY_GROUP: GroupTransform = { sx: 1, sy: 1, tx: 0, ty: 0 }

const CHILD_TAG_RE = /<p:(grpSp|sp|pic|graphicFrame|cxnSp)(?=[\s/>])/g

/** Index just past the balanced closing tag for `<p:name>` opened before `from`. */
function findMatchingEnd(xml: string, name: string, from: number): number {
  const re = new RegExp(`<p:${name}(?=[\\s/>])|</p:${name}>`, 'g')
  re.lastIndex = from
  let depth = 1
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    if (m[0][1] === '/') {
      depth--
      if (depth === 0) return m.index + m[0].length
    } else {
      const gt = xml.indexOf('>', m.index)
      if (gt === -1 || xml[gt - 1] !== '/') depth++ // not self-closing
    }
  }
  return xml.length
}

interface Child {
  name: string
  body: string
}

/** Direct shape/group children of a container's inner XML, in document order. */
function directChildren(inner: string): Child[] {
  const out: Child[] = []
  let i = 0
  while (i < inner.length) {
    CHILD_TAG_RE.lastIndex = i
    const m = CHILD_TAG_RE.exec(inner)
    if (!m) break
    const name = m[1]
    const start = m.index
    const tagEnd = inner.indexOf('>', start)
    if (tagEnd === -1) break
    const end = inner[tagEnd - 1] === '/' ? tagEnd + 1 : findMatchingEnd(inner, name, tagEnd + 1)
    out.push({ name, body: inner.slice(start, end) })
    i = end
  }
  return out
}

/** Inner XML of a `<p:grpSp>` block (without its own wrapper tag). */
function groupInner(groupXml: string): string {
  const open = groupXml.match(/^<p:grpSp\b[^>]*>/)
  const close = groupXml.lastIndexOf('</p:grpSp>')
  if (!open || close === -1) return ''
  return groupXml.slice(open[0].length, close)
}

/** Compose a parent transform with a group's own xfrm (off/ext + chOff/chExt). */
function composeGroup(parent: GroupTransform, grpXml: string): GroupTransform {
  const off = grpXml.match(/<a:off x="(-?\d+)" y="(-?\d+)"/)
  const ext = grpXml.match(/<a:ext cx="(\d+)" cy="(\d+)"/)
  const chOff = grpXml.match(/<a:chOff x="(-?\d+)" y="(-?\d+)"/)
  const chExt = grpXml.match(/<a:chExt cx="(\d+)" cy="(\d+)"/)
  if (!off || !ext || !chOff || !chExt) return parent
  const extX = emuToIn(parseInt(ext[1]))
  const extY = emuToIn(parseInt(ext[2]))
  const chExtX = emuToIn(parseInt(chExt[1]))
  const chExtY = emuToIn(parseInt(chExt[2]))
  const sxL = chExtX !== 0 ? extX / chExtX : 1
  const syL = chExtY !== 0 ? extY / chExtY : 1
  const txL = emuToIn(parseInt(off[1])) - emuToIn(parseInt(chOff[1])) * sxL
  const tyL = emuToIn(parseInt(off[2])) - emuToIn(parseInt(chOff[2])) * syL
  return {
    sx: parent.sx * sxL,
    sy: parent.sy * syL,
    tx: parent.sx * txL + parent.tx,
    ty: parent.sy * tyL + parent.ty,
  }
}

/** Map a shape's local xfrm into absolute slide inches via its group transform. */
function absRect(local: Xfrm, gt: GroupTransform): Xfrm {
  return {
    x: gt.sx * local.x + gt.tx,
    y: gt.sy * local.y + gt.ty,
    w: local.w * gt.sx,
    h: local.h * gt.sy,
  }
}

/** Placeholder positions resolved from the slide's layout + master. */
interface PlaceholderXfrms {
  byIdx: Map<string, Xfrm>
  byType: Map<string, Xfrm>
}

function normPhType(type: string | undefined): string {
  if (!type) return 'body' // a bare <p:ph/> defaults to a body placeholder
  if (type === 'ctrTitle') return 'title'
  if (type === 'subTitle') return 'body'
  return type
}

// Last-resort positions (source inches) so placeholder text is never dropped
// when neither the slide, layout nor master carries an explicit xfrm.
const DEFAULT_PH: Record<string, Xfrm> = {
  title: { x: 0.5, y: 0.3, w: 9, h: 1.2 },
  body: { x: 0.5, y: 1.6, w: 9, h: 5.2 },
}

function resolvePlaceholder(
  type: string | undefined,
  idx: string | undefined,
  maps: PlaceholderXfrms
): Xfrm | null {
  const t = normPhType(type)
  if (idx && maps.byIdx.has(idx)) return maps.byIdx.get(idx)!
  if (maps.byType.has(t)) return maps.byType.get(t)!
  if (t !== 'body' && maps.byType.has('body')) return maps.byType.get('body')!
  return null
}

function relTargetToZipPath(target: string): string {
  return ('ppt/' + target.replace(/^\.\.\//, '').replace(/^\//, '')).replace('ppt/ppt/', 'ppt/')
}

/** Resolve a slide's layout + master zip paths via the rels chain. */
async function layoutMasterPaths(
  zip: JSZip,
  slidePath: string
): Promise<{ layout: string | null; master: string | null }> {
  const slideName = slidePath.split('/').pop()
  const relsFile = zip.file(`ppt/slides/_rels/${slideName}.rels`)
  if (!relsFile) return { layout: null, master: null }
  const relsXml = await relsFile.async('text')
  const layoutMatch = relsXml.match(/Target="([^"]*slideLayout\d+\.xml)"/)
  let layout: string | null = null
  let master: string | null = null
  if (layoutMatch) {
    layout = relTargetToZipPath(layoutMatch[1])
    const layoutName = layout.split('/').pop()
    const layoutRels = zip.file(`ppt/slideLayouts/_rels/${layoutName}.rels`)
    if (layoutRels) {
      const lr = await layoutRels.async('text')
      const masterMatch = lr.match(/Target="([^"]*slideMaster\d+\.xml)"/)
      if (masterMatch) master = relTargetToZipPath(masterMatch[1])
    }
  }
  return { layout, master }
}

/**
 * Resolve a slide's background, walking slide → layout → master and honoring
 * theme/scheme colors and gradients. PowerPoint commonly defines the real
 * background only on the master (often via a scheme color), so without this the
 * deck's color theme is lost and slides fall back to white.
 */
async function resolveSlideBg(
  zip: JSZip,
  slideXml: string,
  slidePath: string,
  ctx: ColorContext
): Promise<{ bg?: string; bgGradient?: SlideGradient }> {
  const { layout, master } = await layoutMasterPaths(zip, slidePath)
  const levels: string[] = [slideXml]
  for (const path of [layout, master]) {
    if (!path) continue
    const file = zip.file(path)
    if (file) levels.push(await file.async('text'))
  }
  for (const lvl of levels) {
    const m = lvl.match(/<p:bg>([\s\S]*?)<\/p:bg>/)
    if (!m) continue
    const inner = m[1]
    const grad = parseGradient(inner, ctx)
    if (grad) return { bg: grad.from, bgGradient: grad }
    // <a:solidFill> on <p:bgPr>, or a color override on a <p:bgRef> theme fill.
    const solid = resolveSolidFill(inner, ctx) ?? resolveColorElement(inner, ctx)
    if (solid) return { bg: solid }
  }
  return {}
}

/**
 * Build placeholder geometry from the slide's layout and master. PowerPoint
 * placeholders inherit position down the slide → layout → master chain, so
 * shapes that omit <a:xfrm> (common in Adobe's PDF→PPTX output) still have a
 * resolvable position. Layout entries override master entries.
 */
async function readPlaceholderXfrms(zip: JSZip, slidePath: string): Promise<PlaceholderXfrms> {
  const byIdx = new Map<string, Xfrm>()
  const byType = new Map<string, Xfrm>()
  const { layout: layoutPath, master: masterPath } = await layoutMasterPaths(zip, slidePath)

  // Master first, then layout, so the more specific layout positions win.
  for (const path of [masterPath, layoutPath]) {
    if (!path) continue
    const file = zip.file(path)
    if (!file) continue
    const xml = await file.async('text')
    for (const m of xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
      const sp = m[0]
      if (!/<p:ph\b/.test(sp)) continue
      const xf = parseXfrm(sp)
      if (!xf) continue
      const idx = sp.match(/<p:ph[^>]*\bidx="([^"]+)"/)?.[1]
      const type = sp.match(/<p:ph[^>]*\btype="([^"]+)"/)?.[1]
      if (idx) byIdx.set(idx, xf)
      byType.set(normPhType(type), xf)
    }
  }
  return { byIdx, byType }
}

async function parseSlide(
  zip: JSZip,
  slidePath: string,
  transform: Transform,
  warnings: string[],
  ctx: ColorContext
): Promise<SlideData> {
  const xml = await zip.file(slidePath)!.async('text')
  const rels = await readSlideRels(zip, slidePath)
  const phXfrms = await readPlaceholderXfrms(zip, slidePath)

  // Slide background: gradient (preferred) or solid fill, resolved through the
  // slide → layout → master chain so the original color theme is preserved.
  const resolvedBg = await resolveSlideBg(zip, xml, slidePath, ctx)
  const bgGradient = resolvedBg.bgGradient ?? null
  const bg = resolvedBg.bg || 'FFFFFF'
  const bgLum = luminance(bg)

  const elements: SlideElement[] = []
  let skippedFrames = 0

  const processShape = async (name: string, shapeXml: string, gt: GroupTransform) => {
    // Tables/charts/SmartArt frames and connectors aren't editable here yet.
    if (name === 'graphicFrame' || name === 'cxnSp') return

    // Position: explicit xfrm, else inherit from the layout/master placeholder.
    const phTag = shapeXml.match(/<p:ph\b[^>]*>/)?.[0]
    const phType = phTag?.match(/\btype="([^"]+)"/)?.[1]
    const phIdx = phTag?.match(/\bidx="([^"]+)"/)?.[1]
    let local = parseXfrm(shapeXml)
    if (!local && phTag) local = resolvePlaceholder(phType, phIdx, phXfrms)

    if (name === 'pic') {
      if (!local) return
      const rect = applyTransform(absRect(local, gt), transform)
      const embed = shapeXml.match(/<a:blip[^>]*r:embed="([^"]+)"/)
      const path = embed ? rels[embed[1]] : undefined
      const src = path ? await mediaDataUrl(zip, path) : null
      if (!src) {
        skippedFrames++
        return
      }
      elements.push({ id: uid('img'), type: 'image', src, ...rect, style: { objectFit: 'contain' } })
      return
    }

    // p:sp — text and/or filled shape. Body/content placeholders inherit a
    // bullet from the master list style even without an explicit <a:buChar>;
    // titles and plain text boxes do not.
    const isBodyPlaceholder = !!phTag && normPhType(phType) !== 'title'
    const text = extractShapeText(shapeXml, isBodyPlaceholder)
    // Placeholder text with no resolvable geometry still gets a sensible spot so
    // it is never silently dropped.
    if (!local) {
      if (!text) return
      local = DEFAULT_PH[normPhType(phType)] ?? DEFAULT_PH.body
    }
    const rect = applyTransform(absRect(local, gt), transform)
    const spPr = shapeXml.match(/<p:spPr>([\s\S]*?)<\/p:spPr>/)
    const spPrFill = spPr ? spPr[1].replace(/<a:ln>[\s\S]*?<\/a:ln>/g, '') : ''
    const fill = spPrFill ? resolveSolidFill(spPrFill, ctx) : undefined
    const fillGradient = spPrFill ? parseGradient(spPrFill, ctx) : null

    if (text) {
      const rPrFull = shapeXml.match(/<a:rPr[\s\S]*?<\/a:rPr>/) // run props with nested fill
      const szMatch = shapeXml.match(/<a:rPr[^>]*\ssz="(\d+)"/)
      const bold = /<a:rPr[^>]*\sb="1"/.test(shapeXml)
      const italic = /<a:rPr[^>]*\si="1"/.test(shapeXml)
      const face = shapeXml.match(/<a:latin[^>]*typeface="([^"]+)"/)
      const runColor = rPrFull ? resolveSolidFill(rPrFull[0], ctx) : undefined
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
        ...rect,
        type: 'rect',
        style: { bg: fillGradient.from, bgGradient: fillGradient },
      })
    } else if (fill) {
      elements.push({ id: uid('rect'), type: 'rect', ...rect, style: { bg: fill } })
    }
  }

  // Recurse through the shape tree, flattening groups (Adobe wraps slide
  // content — even full-bleed backgrounds — inside <p:grpSp>). Document order
  // is preserved so back-to-front z-order matches the original.
  const walk = async (inner: string, gt: GroupTransform): Promise<void> => {
    for (const child of directChildren(inner)) {
      if (child.name === 'grpSp') {
        await walk(groupInner(child.body), composeGroup(gt, child.body))
      } else {
        await processShape(child.name, child.body, gt)
      }
    }
  }

  const treeMatch = xml.match(/<p:spTree>([\s\S]*?)<\/p:spTree>/)
  if (treeMatch) await walk(treeMatch[1], IDENTITY_GROUP)

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

  // Theme palette + master color map, shared across all slides so scheme
  // colors resolve to the deck's real colors.
  const ctx = await loadColorContext(zip)

  const slides: SlideData[] = []
  for (const path of slidePaths) {
    slides.push(await parseSlide(zip, path, transform, warnings, ctx))
  }

  // De-duplicate warnings.
  return { slides, warnings: Array.from(new Set(warnings)) }
}
