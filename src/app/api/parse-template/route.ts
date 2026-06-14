import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { buildTemplateKnowledge } from '@/lib/templateKnowledge'
import { parsePdfTemplate } from '@/lib/parsePdfTemplate'

export const runtime = 'nodejs'

// ── XML helpers ────────────────────────────────────────────────────────────────

/** Extract all text values from <a:t> tags */
function extractText(xml: string): string[] {
  const matches = Array.from(xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g))
  return matches.map(m => m[1].trim()).filter(Boolean)
}

/** Extract unique hex colors from solidFill/srgbClr and sysClr */
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

/** Extract font names */
function extractFonts(xml: string): string[] {
  const fonts = new Set<string>()
  Array.from(xml.matchAll(/typeface="([^"]+)"/g)).forEach(m => {
    const f = m[1]
    if (!f.startsWith('+') && f !== '') fonts.add(f)
  })
  return Array.from(fonts)
}

/** Extract font sizes (in hundredths of a point → divide by 100) */
function extractFontSizes(xml: string): number[] {
  const sizes = new Set<number>()
  Array.from(xml.matchAll(/sz="(\d+)"/g)).forEach(m => {
    sizes.add(Math.round(parseInt(m[1]) / 100))
  })
  return Array.from(sizes).sort((a, b) => a - b)
}

/** Extract shape positions/sizes as rough layout info */
function extractLayout(xml: string): string {
  const shapes: string[] = []
  const spMatches = Array.from(xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g))
  for (const sp of spMatches.slice(0, 20)) {
    const spXml = sp[1]
    const texts = extractText(spXml)
    const offMatch = spXml.match(/off x="(\d+)" y="(\d+)"/)
    const extMatch = spXml.match(/ext cx="(\d+)" cy="(\d+)"/)
    if (offMatch && extMatch && texts.length) {
      // EMUs → inches (914400 EMU = 1 inch)
      const x = (parseInt(offMatch[1]) / 914400).toFixed(2)
      const y = (parseInt(offMatch[2]) / 914400).toFixed(2)
      const w = (parseInt(extMatch[1]) / 914400).toFixed(2)
      const h = (parseInt(extMatch[2]) / 914400).toFixed(2)
      shapes.push(`  "${texts[0].slice(0, 50)}" at (${x}",${y}") size ${w}"×${h}"`)
    }
  }
  return shapes.join('\n')
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

    const lower = file.name.toLowerCase()
    const buffer = Buffer.from(await file.arrayBuffer())

    if (lower.endsWith('.pdf')) {
      const result = await parsePdfTemplate(buffer, file.name)
      return NextResponse.json(result)
    }

    if (!lower.endsWith('.pptx')) {
      return NextResponse.json({ error: 'Only .pptx or .pdf files are supported' }, { status: 400 })
    }

    const zip = await JSZip.loadAsync(buffer)

    // ── Extract theme colors ──────────────────────────────────────────────────
    let themeColors: string[] = []
    const themeFile = zip.file('ppt/theme/theme1.xml')
    if (themeFile) {
      const themeXml = await themeFile.async('text')
      themeColors = extractColors(themeXml)
    }

    // ── Extract slide master fonts & colors ───────────────────────────────────
    let masterFonts: string[] = []
    const masterFile = zip.file('ppt/slideMasters/slideMaster1.xml')
    if (masterFile) {
      const masterXml = await masterFile.async('text')
      masterFonts = extractFonts(masterXml)
    }

    // ── Process each slide ────────────────────────────────────────────────────
    const slides: Array<{
      index: number
      texts: string[]
      colors: string[]
      fonts: string[]
      fontSizes: number[]
      layout: string
    }> = []

    const slideFiles = Object.keys(zip.files)
      .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const na = parseInt(a.match(/\d+/)![0])
        const nb = parseInt(b.match(/\d+/)![0])
        return na - nb
      })

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

    // ── Build template knowledge summary ──────────────────────────────────────
    const allColors = Array.from(new Set([
      ...themeColors,
      ...slides.flatMap(s => s.colors),
    ])).slice(0, 20)

    const allFonts = Array.from(new Set([
      ...masterFonts,
      ...slides.flatMap(s => s.fonts),
    ]))

    const allSizes = Array.from(new Set(slides.flatMap(s => s.fontSizes))).sort((a, b) => a - b)

    const slideDescriptions = slides.map(s => {
      const headline = s.texts[0] || '(no text)'
      const preview = s.texts.slice(0, 6).join(' · ')
      return `  Slide ${s.index}: "${headline}" | ${preview.slice(0, 120)}`
    })

    const result = buildTemplateKnowledge({
      filename: file.name,
      source: 'pptx',
      pageCount: slides.length,
      colors: allColors,
      fonts: allFonts,
      fontSizes: allSizes,
      pageDescriptions: slideDescriptions,
      layoutSample: slides[0]?.layout || '  (none)',
    })

    return NextResponse.json(result)
  } catch (err) {
    console.error('parse-template error:', err)
    return NextResponse.json({ error: 'Failed to parse template' }, { status: 500 })
  }
}
