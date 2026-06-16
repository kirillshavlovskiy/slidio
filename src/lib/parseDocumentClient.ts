import JSZip from 'jszip'

// Cap stored text so a huge file can't bloat the knowledge context / DB row.
// Keep this in sync with the server route (src/app/api/parse-document/route.ts).
const MAX_CHARS = 200_000

const TEXT_EXTENSIONS = [
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.yaml', '.yml',
  '.html', '.htm', '.xml', '.log', '.text', '.rst', '.ini', '.toml',
]

export interface ParsedDocument {
  name: string
  text: string
  chars: number
  truncated: boolean
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Pull readable text out of a .docx (Open XML) by reading word/document.xml. */
async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const doc = zip.file('word/document.xml')
  if (!doc) return ''
  const xml = await doc.async('text')
  return decodeEntities(
    xml
      .replace(/<w:p\b[^>]*>/g, '\n') // paragraph start → newline
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<[^>]+>/g, '') // strip remaining tags
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Extract the text layer from a PDF using pdf.js (worker served from /public). */
async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise
  const parts: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const line = content.items
      .map(item => ('str' in item ? item.str : ''))
      .join(' ')
    parts.push(line)
    if (parts.join('\n').length > MAX_CHARS) break
  }
  await doc.destroy().catch(() => {})
  return parts.join('\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Parse a knowledge-base document entirely in the browser and return its text.
 *
 * Doing this client-side avoids uploading the (potentially large) binary to the
 * serverless API, which has a hard ~4.5MB request body limit — big DOCX/PDF
 * files were being rejected with HTTP 413 before they ever reached the handler.
 *
 * Throws an Error with a user-facing message on unsupported types / empty text.
 */
export async function parseDocumentToText(file: File): Promise<ParsedDocument> {
  const lower = file.name.toLowerCase()
  let text = ''

  if (lower.endsWith('.pdf')) {
    text = await extractPdfText(await file.arrayBuffer())
  } else if (lower.endsWith('.docx')) {
    text = await extractDocxText(await file.arrayBuffer())
  } else if (TEXT_EXTENSIONS.some(ext => lower.endsWith(ext))) {
    text = await file.text()
  } else {
    throw new Error(
      'Unsupported file type. Use PDF, DOCX, TXT, MD, CSV, JSON, YAML, HTML or XML.'
    )
  }

  text = text.trim()
  if (!text) {
    throw new Error('No readable text could be extracted from this file.')
  }

  const truncated = text.length > MAX_CHARS
  if (truncated) text = text.slice(0, MAX_CHARS) + '\n\n…[truncated]'

  return {
    name: file.name.replace(/\.[^.]+$/, ''),
    text,
    chars: text.length,
    truncated,
  }
}
