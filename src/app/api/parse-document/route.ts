import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { extractPdfPlainText } from '@/lib/parsePdfTemplate'

export const runtime = 'nodejs'

// Cap stored text so a huge file can't bloat the knowledge context / DB row.
const MAX_CHARS = 200_000

const TEXT_EXTENSIONS = [
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

/** Pull readable text out of a .docx (Open XML) by reading word/document.xml. */
async function extractDocxText(buffer: Buffer): Promise<string> {
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

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

    const lower = file.name.toLowerCase()
    let text = ''

    if (lower.endsWith('.pdf')) {
      const buffer = Buffer.from(await file.arrayBuffer())
      text = extractPdfPlainText(buffer)
    } else if (lower.endsWith('.docx')) {
      const buffer = Buffer.from(await file.arrayBuffer())
      text = await extractDocxText(buffer)
    } else if (TEXT_EXTENSIONS.some(ext => lower.endsWith(ext))) {
      text = await file.text()
    } else {
      return NextResponse.json(
        { error: 'Unsupported file type. Use PDF, DOCX, TXT, MD, CSV, JSON, YAML, HTML or XML.' },
        { status: 400 }
      )
    }

    text = text.trim()
    if (!text) {
      return NextResponse.json(
        { error: 'No readable text could be extracted from this file.' },
        { status: 422 }
      )
    }

    const truncated = text.length > MAX_CHARS
    if (truncated) text = text.slice(0, MAX_CHARS) + '\n\n…[truncated]'

    return NextResponse.json({
      name: file.name.replace(/\.[^.]+$/, ''),
      text,
      chars: text.length,
      truncated,
    })
  } catch (err) {
    console.error('parse-document error:', err)
    return NextResponse.json({ error: 'Failed to parse document' }, { status: 500 })
  }
}
