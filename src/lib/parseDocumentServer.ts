import JSZip from 'jszip'
import { extractPdfPlainText } from '@/lib/parsePdfTemplate'
import { extractPptxText } from '@/lib/ooxmlTextExtract'
import { extractTextWithSkill, needsSkillExtract } from '@/lib/graph/skillExtract'

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
  if (lower.endsWith('.pptx') || lower.endsWith('.pptm')) return 'pptx'
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm') || lower.endsWith('.xls')) return 'xlsx'
  for (const ext of TEXT_EXTENSIONS) {
    if (lower.endsWith(ext)) return ext.slice(1)
  }
  return 'unknown'
}

async function parseWithSkillFallback(
  buffer: Buffer,
  filename: string,
  localText: string
): Promise<string> {
  if (localText.trim()) return localText
  if (!needsSkillExtract(filename)) return localText
  return extractTextWithSkill(buffer, filename)
}

export async function parseBufferToText(buffer: Buffer, filename: string): Promise<string> {
  const lower = filename.toLowerCase()
  let text = ''

  if (lower.endsWith('.pdf')) {
    text = await parseWithSkillFallback(buffer, filename, extractPdfPlainText(buffer))
  } else if (lower.endsWith('.docx')) {
    text = await parseWithSkillFallback(buffer, filename, await extractDocxText(buffer))
  } else if (lower.endsWith('.pptx') || lower.endsWith('.pptm')) {
    try {
      text = await extractPptxText(buffer)
    } catch {
      text = ''
    }
    text = await parseWithSkillFallback(buffer, filename, text)
  } else if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm') || lower.endsWith('.xls')) {
    text = await extractTextWithSkill(buffer, filename)
  } else if (TEXT_EXTENSIONS.some(ext => lower.endsWith(ext))) {
    text = buffer.toString('utf-8')
  } else {
    throw new Error(
      'Unsupported file type. Use PDF, DOCX, PPTX, XLSX, TXT, MD, CSV, JSON, YAML, HTML or XML.'
    )
  }

  text = text.trim()
  if (!text) throw new Error('No readable text could be extracted from this file.')
  return text
}
