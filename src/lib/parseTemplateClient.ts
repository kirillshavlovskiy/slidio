import JSZip from 'jszip'
import { buildTemplateKnowledge, type TemplateKnowledge } from './templateKnowledge'

// Parse design templates entirely in the browser so large .pptx / .key files
// don't hit the serverless request body limit (~4.5MB) that rejected uploads
// with HTTP 413. PDFs still go through the server route (pdf-parse is Node-only).

// ── OOXML (.pptx) helpers — mirror src/app/api/parse-template/route.ts ──────────

function extractText(xml: string): string[] {
  const matches = Array.from(xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g))
  return matches.map(m => m[1].trim()).filter(Boolean)
}

function extractColors(xml: string): string[] {
  const patterns = [
    /<a:srgbClr val="([0-9A-Fa-f]{6})"/g,
    /<p:clrVal>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"/g,
  ]
  const colors = new Set<string>()
  patterns.forEach(pattern => {
    Array.from(xml.matchAll(pattern)).forEach(m => colors.add(m[1].toUpperCase()))
  })
  return Array.from(colors)
}

function extractFonts(xml: string): string[] {
  const fonts = new Set<string>()
  Array.from(xml.matchAll(/typeface="([^"]+)"/g)).forEach(m => {
    const f = m[1]
    if (!f.startsWith('+') && f !== '') fonts.add(f)
  })
  return Array.from(fonts)
}

function extractFontSizes(xml: string): number[] {
  const sizes = new Set<number>()
  Array.from(xml.matchAll(/sz="(\d+)"/g)).forEach(m => {
    sizes.add(Math.round(parseInt(m[1]) / 100))
  })
  return Array.from(sizes).sort((a, b) => a - b)
}

function extractLayout(xml: string): string {
  const shapes: string[] = []
  const spMatches = Array.from(xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g))
  for (const sp of spMatches.slice(0, 20)) {
    const spXml = sp[1]
    const texts = extractText(spXml)
    const offMatch = spXml.match(/off x="(\d+)" y="(\d+)"/)
    const extMatch = spXml.match(/ext cx="(\d+)" cy="(\d+)"/)
    if (offMatch && extMatch && texts.length) {
      const x = (parseInt(offMatch[1]) / 914400).toFixed(2)
      const y = (parseInt(offMatch[2]) / 914400).toFixed(2)
      const w = (parseInt(extMatch[1]) / 914400).toFixed(2)
      const h = (parseInt(extMatch[2]) / 914400).toFixed(2)
      shapes.push(`  "${texts[0].slice(0, 50)}" at (${x}",${y}") size ${w}"×${h}"`)
    }
  }
  return shapes.join('\n')
}

async function parsePptx(file: File): Promise<TemplateKnowledge> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())

  let themeColors: string[] = []
  const themeFile = zip.file('ppt/theme/theme1.xml')
  if (themeFile) themeColors = extractColors(await themeFile.async('text'))

  let masterFonts: string[] = []
  const masterFile = zip.file('ppt/slideMasters/slideMaster1.xml')
  if (masterFile) masterFonts = extractFonts(await masterFile.async('text'))

  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => parseInt(a.match(/\d+/)![0]) - parseInt(b.match(/\d+/)![0]))

  const slides = [] as Array<{
    index: number
    texts: string[]
    colors: string[]
    fonts: string[]
    fontSizes: number[]
    layout: string
  }>
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]].async('text')
    slides.push({
      index: i + 1,
      texts: extractText(xml),
      colors: extractColors(xml),
      fonts: extractFonts(xml),
      fontSizes: extractFontSizes(xml),
      layout: extractLayout(xml),
    })
  }

  const allColors = Array.from(
    new Set([...themeColors, ...slides.flatMap(s => s.colors)])
  ).slice(0, 20)
  const allFonts = Array.from(new Set([...masterFonts, ...slides.flatMap(s => s.fonts)]))
  const allSizes = Array.from(new Set(slides.flatMap(s => s.fontSizes))).sort((a, b) => a - b)

  const slideDescriptions = slides.map(s => {
    const headline = s.texts[0] || '(no text)'
    const preview = s.texts.slice(0, 6).join(' · ')
    return `  Slide ${s.index}: "${headline}" | ${preview.slice(0, 120)}`
  })

  return buildTemplateKnowledge({
    filename: file.name,
    source: 'pptx',
    pageCount: slides.length,
    colors: allColors,
    fonts: allFonts,
    fontSizes: allSizes,
    pageDescriptions: slideDescriptions,
    layoutSample: slides[0]?.layout || '  (none)',
  })
}

// ── Keynote (.key) — best effort ────────────────────────────────────────────────
// Modern .key files store data as Snappy-compressed protobuf (IWA) inside the
// zip, which we can't decode with simple tooling. We still let it load: count
// the slides from the package and capture any theme/background images so the AI
// at least knows the deck size and that it's a Keynote source.
async function parseKeynote(file: File): Promise<TemplateKnowledge> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const names = Object.keys(zip.files)

  // Keynote keeps one IWA per slide under Index/ (e.g. Index/Slide-12.iwa).
  const slideCount =
    names.filter(n => /index\/slide(-\d+)?\.iwa$/i.test(n)).length ||
    names.filter(n => /\/slide[^/]*\.(iwa|apxl)$/i.test(n)).length ||
    0

  return buildTemplateKnowledge({
    filename: file.name,
    source: 'keynote',
    pageCount: slideCount,
    colors: [],
    fonts: [],
    fontSizes: [],
    pageDescriptions: [
      slideCount > 0
        ? `  Keynote deck with ${slideCount} slide${slideCount === 1 ? '' : 's'}.`
        : '  Keynote deck (slide count unavailable).',
    ],
    layoutSample:
      '  Keynote internals use a binary format that can\'t be fully parsed in the ' +
      'browser. Colors, fonts and per-slide text were not extracted — for full ' +
      'style analysis, export this deck as PDF or PowerPoint (.pptx) and upload that.',
  })
}

const PPTX_RE = /\.pptx$/i
const KEY_RE = /\.key$/i

export function isClientParsableTemplate(name: string): boolean {
  return PPTX_RE.test(name) || KEY_RE.test(name)
}

/** Parse a .pptx or .key template in the browser. Throws on unsupported types. */
export async function parseTemplateClient(file: File): Promise<TemplateKnowledge> {
  if (PPTX_RE.test(file.name)) return parsePptx(file)
  if (KEY_RE.test(file.name)) return parseKeynote(file)
  throw new Error(`Unsupported template type: ${file.name}`)
}
