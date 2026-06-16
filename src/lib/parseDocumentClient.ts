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

// ── DOCX (.docx) structured extraction ─────────────────────────────────────────
// A naive "strip every tag" pass turns tables into an unreadable stream of cell
// text, so the model can no longer tell which value belongs to which row/column.
// We instead walk word/document.xml in document order and preserve structure:
// tables → Markdown grids, list paragraphs → bullets, everything else → lines.

const isEl = (n: Node): n is Element => n.nodeType === 1

/** Collect the inline text of a node (handles <w:t>, tabs and line breaks). */
function collectInline(node: Node): string {
  let out = ''
  node.childNodes.forEach(child => {
    if (!isEl(child)) return
    const ln = child.localName
    if (ln === 't') out += child.textContent ?? ''
    else if (ln === 'tab') out += '\t'
    else if (ln === 'br' || ln === 'cr') out += '\n'
    else out += collectInline(child)
  })
  return out
}

/** Render one paragraph; list items (numPr) are prefixed with a bullet. */
function paragraphText(p: Element): string {
  const text = collectInline(p).replace(/[ \t]+\n/g, '\n').trim()
  if (!text) return ''
  const isListItem = p.getElementsByTagName('*').length
    ? Array.from(p.getElementsByTagName('*')).some(e => e.localName === 'numPr')
    : false
  return isListItem ? `- ${text.replace(/\n+/g, ' ')}` : text
}

/** Flatten a table cell to a single, pipe-safe line. */
function cellText(tc: Element): string {
  const paras = Array.from(tc.children)
    .filter(c => c.localName === 'p')
    .map(p => collectInline(p).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  // Fallback: if a cell has no direct paragraphs (e.g. nested structure), grab all text.
  const raw = paras.length ? paras.join(' ') : collectInline(tc).replace(/\s+/g, ' ').trim()
  return raw.replace(/\|/g, '\\|')
}

/** Render a <w:tbl> as a GitHub-style Markdown table so rows/columns survive. */
function renderTable(tbl: Element): string {
  const rows = Array.from(tbl.children).filter(c => c.localName === 'tr')
  if (rows.length === 0) return ''
  const grid = rows.map(tr =>
    Array.from(tr.children)
      .filter(c => c.localName === 'tc')
      .map(cellText)
  )
  const cols = Math.max(...grid.map(r => r.length))
  if (cols === 0) return ''
  const pad = (r: string[]) => {
    const cells = [...r]
    while (cells.length < cols) cells.push('')
    return `| ${cells.join(' | ')} |`
  }
  const lines = [pad(grid[0]), `| ${Array(cols).fill('---').join(' | ')} |`]
  for (let i = 1; i < grid.length; i++) lines.push(pad(grid[i]))
  return lines.join('\n')
}

/** Walk block-level content in document order, preserving structure. */
function walkBlocks(node: Node, out: string[]): void {
  node.childNodes.forEach(child => {
    if (!isEl(child)) return
    const ln = child.localName
    if (ln === 'tbl') {
      const t = renderTable(child)
      if (t) out.push(t)
    } else if (ln === 'p') {
      const t = paragraphText(child)
      if (t) out.push(t)
    } else {
      // Unknown container (sectPr wrappers, sdt content controls, etc.) — recurse
      // so paragraphs/tables nested inside still come through in order.
      walkBlocks(child, out)
    }
  })
}

/** Regex fallback if the XML can't be DOM-parsed (keeps text, loses table grid). */
function extractDocxTextRegex(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<\/w:tr>/g, '\n')
      .replace(/<\/w:tc>/g, ' | ')
      .replace(/<w:p\b[^>]*>/g, '\n')
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Pull readable, STRUCTURE-PRESERVING text out of a .docx (Open XML). */
async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const doc = zip.file('word/document.xml')
  if (!doc) return ''
  const xml = await doc.async('text')

  // DOMParser is a browser global (this module is client-only) and lets us keep
  // table/list structure that a flat tag-strip would destroy.
  try {
    const dom = new DOMParser().parseFromString(xml, 'application/xml')
    if (dom.getElementsByTagName('parsererror').length > 0) {
      return extractDocxTextRegex(xml)
    }
    const bodies = dom.getElementsByTagName('w:body')
    const body: Node = bodies.length ? bodies[0] : dom.documentElement
    const out: string[] = []
    walkBlocks(body, out)
    const text = out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
    return text || extractDocxTextRegex(xml)
  } catch {
    return extractDocxTextRegex(xml)
  }
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
