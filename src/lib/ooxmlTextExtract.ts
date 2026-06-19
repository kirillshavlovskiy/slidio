import JSZip from 'jszip'

function extractTextFromXml(xml: string): string[] {
  return Array.from(xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g))
    .map(m => m[1].trim())
    .filter(Boolean)
}

/** Pull slide text from a .pptx (OOXML) buffer — structure preserved per slide. */
export async function extractPptxText(buffer: ArrayBuffer | Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/i)?.[1] || '0', 10)
      const nb = parseInt(b.match(/slide(\d+)/i)?.[1] || '0', 10)
      return na - nb
    })

  const parts: string[] = []
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]].async('text')
    const texts = extractTextFromXml(xml)
    if (texts.length) {
      parts.push(`--- Slide ${i + 1} ---\n${texts.join('\n')}`)
    }
  }
  return parts.join('\n\n').trim()
}
