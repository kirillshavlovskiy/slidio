import { buildTemplateKnowledge } from './templateKnowledge'

function rgbToHex(r: number, g: number, b: number): string {
  return [r, g, b]
    .map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

function decodePdfLiteralString(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
}

function extractColorsFromRaw(buffer: Buffer): string[] {
  const raw = buffer.toString('latin1')
  const colors = new Set<string>()

  for (const m of Array.from(raw.matchAll(/(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s+rg/g))) {
    colors.add(rgbToHex(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])))
  }

  for (const m of Array.from(raw.matchAll(/(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s+RG/g))) {
    colors.add(rgbToHex(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])))
  }

  return Array.from(colors)
}

function extractPdfText(buffer: Buffer): string[] {
  const raw = buffer.toString('latin1')
  const lines: string[] = []

  for (const m of raw.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
    const text = decodePdfLiteralString(m[1]).trim()
    if (text) lines.push(text)
  }

  for (const m of raw.matchAll(/\[(.*?)\]\s*TJ/g)) {
    for (const sm of m[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)) {
      const text = decodePdfLiteralString(sm[1]).trim()
      if (text) lines.push(text)
    }
  }

  return lines
}

/** Best-effort raw text extraction from a PDF, as a single newline-joined string. */
export function extractPdfPlainText(buffer: Buffer): string {
  return extractPdfText(buffer).join('\n')
}

function countPdfPages(buffer: Buffer): number {
  const raw = buffer.toString('latin1')
  const matches = raw.match(/\/Type\s*\/Page\b/g)
  return Math.max(1, matches?.length ?? 1)
}

export async function parsePdfTemplate(buffer: Buffer, filename: string) {
  const pageCount = countPdfPages(buffer)
  const lines = extractPdfText(buffer)

  const colors = extractColorsFromRaw(buffer).slice(0, 20)
  const fonts: string[] = []
  const fontSizes: number[] = [12, 14, 24, 32]

  const pageDescriptions: string[] = []
  const linesPerPage = Math.max(1, Math.ceil(lines.length / pageCount))

  for (let p = 0; p < Math.min(pageCount, 5); p++) {
    const chunk = lines.slice(p * linesPerPage, (p + 1) * linesPerPage)
    const headline = chunk[0] || '(no text)'
    const preview = chunk.slice(0, 6).join(' · ')
    pageDescriptions.push(`  Page ${p + 1}: "${headline}" | ${preview.slice(0, 120)}`)
  }

  const layoutSample =
    lines.slice(0, 8).map((line, i) => `  Line ${i + 1}: "${line.slice(0, 60)}"`).join('\n') ||
    '  (no text extracted)'

  return buildTemplateKnowledge({
    filename,
    source: 'pdf',
    pageCount,
    colors,
    fonts,
    fontSizes,
    pageDescriptions,
    layoutSample,
  })
}
