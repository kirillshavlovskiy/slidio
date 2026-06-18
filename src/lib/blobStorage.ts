import { put } from '@vercel/blob'
import fs from 'node:fs/promises'
import path from 'node:path'

const INLINE_TEXT_PREFIX = 'inline://'

/** Vercel serverless has a read-only filesystem — never write to ./storage there. */
export function isServerlessEnv(): boolean {
  return process.env.VERCEL === '1'
}

function storageRoot(): string {
  if (isServerlessEnv()) {
    return path.join('/tmp', 'deck-editor-storage')
  }
  return path.resolve(process.env.STORAGE_PATH || './storage')
}

const LOCAL_FILES_PREFIX = '/api/graph/files/'

function hasBlobToken(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN
}

function token(): string {
  const t = process.env.BLOB_READ_WRITE_TOKEN
  if (!t) throw new Error('BLOB_READ_WRITE_TOKEN is not configured')
  return t
}

function sourceRelPath(branchId: string, sourceId: string, ...parts: string[]): string {
  return path.join('graph', branchId, 'sources', sourceId, ...parts)
}

function localBlobUrl(relPath: string): string {
  const normalized = relPath.split(path.sep).join('/')
  return `${LOCAL_FILES_PREFIX}${normalized}`
}

export function inlineTextUrl(sourceId: string): string {
  return `${INLINE_TEXT_PREFIX}${sourceId}`
}

export function isInlineTextUrl(url: string): boolean {
  return url.startsWith(INLINE_TEXT_PREFIX)
}

export function inlineTextSourceId(url: string): string | null {
  if (!isInlineTextUrl(url)) return null
  return url.slice(INLINE_TEXT_PREFIX.length) || null
}

async function putLocal(relPath: string, data: Buffer | string): Promise<string> {
  const root = storageRoot()
  const abs = path.resolve(root, relPath)
  if (!abs.startsWith(root + path.sep)) {
    throw new Error('Invalid storage path')
  }
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, data)
  return localBlobUrl(relPath)
}

export function isLocalBlobUrl(url: string): boolean {
  return url.startsWith(LOCAL_FILES_PREFIX) || url.includes(`${LOCAL_FILES_PREFIX}`)
}

export function localPathFromUrl(url: string): string | null {
  const idx = url.indexOf(LOCAL_FILES_PREFIX)
  if (idx === -1) return null
  return url.slice(idx + LOCAL_FILES_PREFIX.length)
}

export async function readStoredBlob(url: string): Promise<Buffer> {
  const trimmed = url?.trim()
  if (!trimmed) throw new Error('Source file is missing — remove this source and upload again')
  if (isInlineTextUrl(trimmed)) {
    throw new Error('Inline text must be read from the database, not blob storage')
  }

  const rel = localPathFromUrl(trimmed)
  if (rel) {
    const root = storageRoot()
    const abs = path.resolve(root, rel)
    if (!abs.startsWith(root + path.sep)) {
      throw new Error('Invalid blob path')
    }
    try {
      return await fs.readFile(abs)
    } catch {
      throw new Error('Source file not found on disk — remove this source and upload again')
    }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('Invalid source file URL — remove this source and upload again')
  }

  const res = await fetch(parsed)
  if (!res.ok) throw new Error(`Failed to fetch blob: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

export async function readStoredText(url: string): Promise<string> {
  const buf = await readStoredBlob(url)
  return buf.toString('utf-8')
}

/** Store raw uploaded source file (Vercel Blob in prod, local disk in dev). */
export async function putSourceFile(
  branchId: string,
  sourceId: string,
  data: Buffer | Blob,
  filename: string
): Promise<string> {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(await data.arrayBuffer())

  if (hasBlobToken()) {
    const pathname = sourceRelPath(branchId, sourceId, filename).split(path.sep).join('/')
    const blob = await put(pathname, buffer, { access: 'public', token: token() })
    return blob.url
  }

  if (isServerlessEnv()) {
    throw new Error(
      'Raw file storage is not configured. Connect Vercel Blob (BLOB_READ_WRITE_TOKEN) or upload via the Documents tab (text is stored in the database).'
    )
  }

  return putLocal(sourceRelPath(branchId, sourceId, filename), buffer)
}

/**
 * Store extracted plain text. Returns a Vercel Blob URL, a local file URL, or
 * `inline://<sourceId>` when on serverless without Blob — caller must save text
 * on SourceDocument.extractedText in that case.
 */
export async function putExtractedText(
  branchId: string,
  sourceId: string,
  text: string
): Promise<string> {
  if (hasBlobToken()) {
    const pathname = sourceRelPath(branchId, sourceId, 'extracted.txt').split(path.sep).join('/')
    const blob = await put(pathname, text, {
      access: 'public',
      token: token(),
      contentType: 'text/plain; charset=utf-8',
    })
    return blob.url
  }

  if (isServerlessEnv()) {
    return inlineTextUrl(sourceId)
  }

  return putLocal(sourceRelPath(branchId, sourceId, 'extracted.txt'), text)
}

/** Blob URLs are public when stored with access: 'public'. */
export function getPublicOrSignedUrl(url: string): string {
  return url
}

export { storageRoot as STORAGE_ROOT, LOCAL_FILES_PREFIX }
