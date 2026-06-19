export type TextSegment = {
  sectionTitle?: string
  text: string
  page?: number
  charStart?: number
  charEnd?: number
}

const MIN_CHUNK = 200
const MAX_CHUNK = 2000

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
}

function splitByHeadings(text: string): { title?: string; body: string }[] {
  const lines = text.split('\n')
  const sections: { title?: string; body: string }[] = []
  let currentTitle: string | undefined
  let currentLines: string[] = []

  const flush = () => {
    const body = currentLines.join('\n').trim()
    if (body) sections.push({ title: currentTitle, body })
    currentLines = []
  }

  for (const line of lines) {
    const heading = line.match(/^(#{1,6}\s+.+)$/) || line.match(/^([A-Z][A-Z0-9\s\-]{2,60})$/)
    if (heading && line.trim().length < 80) {
      flush()
      currentTitle = heading[1].replace(/^#+\s*/, '').trim()
    } else {
      currentLines.push(line)
    }
  }
  flush()
  return sections.length ? sections : [{ body: text }]
}

function packSegments(parts: { title?: string; text: string; page?: number }[]): TextSegment[] {
  const out: TextSegment[] = []
  let buffer = ''
  let bufferTitle: string | undefined
  let bufferPage: number | undefined

  const flushBuffer = () => {
    const t = buffer.trim()
    if (t.length >= 40) {
      out.push({
        sectionTitle: bufferTitle,
        text: t,
        page: bufferPage,
      })
    }
    buffer = ''
    bufferTitle = undefined
    bufferPage = undefined
  }

  for (const part of parts) {
    if (part.text.length > MAX_CHUNK) {
      flushBuffer()
      const paras = splitParagraphs(part.text)
      for (const para of paras) {
        if (para.length <= MAX_CHUNK) {
          out.push({ sectionTitle: part.title, text: para, page: part.page })
        } else {
          for (let i = 0; i < para.length; i += MAX_CHUNK) {
            out.push({
              sectionTitle: part.title,
              text: para.slice(i, i + MAX_CHUNK),
              page: part.page,
            })
          }
        }
      }
      continue
    }

    const candidate = buffer ? `${buffer}\n\n${part.text}` : part.text
    if (candidate.length <= MAX_CHUNK) {
      buffer = candidate
      bufferTitle = bufferTitle ?? part.title
      bufferPage = bufferPage ?? part.page
    } else {
      flushBuffer()
      buffer = part.text
      bufferTitle = part.title
      bufferPage = part.page
    }
  }
  flushBuffer()

  // Merge tiny trailing chunks into previous
  const merged: TextSegment[] = []
  for (const seg of out) {
    if (merged.length && seg.text.length < MIN_CHUNK) {
      const prev = merged[merged.length - 1]
      if (prev.text.length + seg.text.length + 2 <= MAX_CHUNK) {
        prev.text = `${prev.text}\n\n${seg.text}`
        continue
      }
    }
    merged.push(seg)
  }
  return merged
}

/** Structure-aware text segmentation for graph ingestion. */
export function segmentDocumentText(
  text: string,
  fileType: string
): TextSegment[] {
  const ft = fileType.toLowerCase()

  if (ft === 'csv' || ft === 'tsv') {
    const lines = text.split('\n').filter(l => l.trim())
    const header = lines[0]
    const rows = lines.slice(1)
    const groupSize = 5
    const parts: { title?: string; text: string }[] = []
    for (let i = 0; i < rows.length; i += groupSize) {
      const group = rows.slice(i, i + groupSize)
      parts.push({
        title: header ? `Rows ${i + 1}–${i + group.length}` : undefined,
        text: [header, ...group].filter(Boolean).join('\n'),
      })
    }
    return packSegments(parts).map((s, idx) => ({ ...s, charStart: idx * 1000 }))
  }

  if (ft === 'pdf') {
    const pages = text.split(/\f|\n--- Page \d+ ---\n/)
    if (pages.length > 1) {
      const parts = pages
        .map((pageText, i) => ({
          title: `Page ${i + 1}`,
          text: pageText.trim(),
          page: i + 1,
        }))
        .filter(p => p.text)
      return packSegments(parts)
    }
  }

  if (ft === 'pptx') {
    const re = /(?:^|\n)--- Slide (\d+) ---\n([\s\S]*?)(?=\n--- Slide \d+ ---|\s*$)/g
    const parts: { title?: string; text: string; page?: number }[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const slideNum = parseInt(m[1], 10)
      const body = m[2].trim()
      if (body) parts.push({ title: `Slide ${slideNum}`, text: body, page: slideNum })
    }
    if (parts.length) return packSegments(parts)

    const mdSlides = text.split(/\n## Slide (\d+)\n/)
    if (mdSlides.length > 2) {
      const mdParts: { title?: string; text: string; page?: number }[] = []
      for (let i = 1; i < mdSlides.length; i += 2) {
        const slideNum = parseInt(mdSlides[i], 10)
        const body = mdSlides[i + 1]?.trim()
        if (body) mdParts.push({ title: `Slide ${slideNum}`, text: body, page: slideNum })
      }
      if (mdParts.length) return packSegments(mdParts)
    }
  }

  if (ft === 'xlsx') {
    const re = /(?:^|\n)## Sheet:?([^\n]*)\n([\s\S]*?)(?=\n## Sheet:?|\s*$)/g
    const parts: { title?: string; text: string }[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const name = m[1].trim() || 'Sheet'
      const body = m[2].trim()
      if (body) parts.push({ title: name, text: body })
    }
    if (parts.length) return packSegments(parts)
  }

  const sections = splitByHeadings(text)
  const parts = sections.flatMap(sec => {
    const paras = splitParagraphs(sec.body)
    return paras.map(p => ({ title: sec.title, text: p }))
  })

  let offset = 0
  const segments = packSegments(parts)
  return segments.map(seg => {
    const start = text.indexOf(seg.text.slice(0, 40), offset)
    const charStart = start >= 0 ? start : offset
    offset = charStart + seg.text.length
    return { ...seg, charStart, charEnd: charStart + seg.text.length }
  })
}
