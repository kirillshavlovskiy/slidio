import JSZip from 'jszip'
import { extractPdfPlainText } from '@/lib/parsePdfTemplate'

export const TEXT_EXTENSIONS = [
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.yaml', '.yml',
  '.html', '.htm', '.xml', '.log', '.text', '.rst', '.ini', '.toml',
]

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const doc = zip.file('word/document.xml')
  if (!doc) return ''
  const xml = await doc.async('text')
  return decodeEntities(
    xml
      .replace(/<w:p\b[^>]*>/g, '\n')
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function fileTypeFromName(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.docx')) return 'docx'
  for (const ext of TEXT_EXTENSIONS) {
    if (lower.endsWith(ext)) return ext.slice(1)
  }
  return 'unknown'
}

export async function parseBufferToText(buffer: Buffer, filename: string): Promise<string> {
  const lower = filename.toLowerCase()
  let text = ''

  if (lower.endsWith('.pdf')) {
    text = extractPdfPlainText(buffer)
  } else if (lower.endsWith('.docx')) {
    text = await extractDocxText(buffer)
  } else if (TEXT_EXTENSIONS.some(ext => lower.endsWith(ext))) {
    text = buffer.toString('utf-8')
  } else {
    throw new Error('Unsupported file type. Use PDF, DOCX, TXT, MD, CSV, JSON, YAML, HTML or XML.')
  }

  text = text.trim()
  if (!text) throw new Error('No readable text could be extracted from this file.')
  return text
}
