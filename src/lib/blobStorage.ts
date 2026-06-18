import { put } from '@vercel/blob'
import fs from 'node:fs/promises'
import path from 'node:path'

const STORAGE_ROOT = path.resolve(process.env.STORAGE_PATH || './storage')
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

async function putLocal(relPath: string, data: Buffer | string): Promise<string> {
  const abs = path.resolve(STORAGE_ROOT, relPath)
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

  const rel = localPathFromUrl(trimmed)
  if (rel) {
    const abs = path.resolve(STORAGE_ROOT, rel)
    if (!abs.startsWith(STORAGE_ROOT + path.sep)) {
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

  if (!hasBlobToken()) {
    return putLocal(sourceRelPath(branchId, sourceId, filename), buffer)
  }

  const pathname = sourceRelPath(branchId, sourceId, filename).split(path.sep).join('/')
  const blob = await put(pathname, buffer, { access: 'public', token: token() })
  return blob.url
}

/** Store extracted plain text artifact for a source document. */
export async function putExtractedText(
  branchId: string,
  sourceId: string,
  text: string
): Promise<string> {
  if (!hasBlobToken()) {
    return putLocal(sourceRelPath(branchId, sourceId, 'extracted.txt'), text)
  }

  const pathname = sourceRelPath(branchId, sourceId, 'extracted.txt').split(path.sep).join('/')
  const blob = await put(pathname, text, {
    access: 'public',
    token: token(),
    contentType: 'text/plain; charset=utf-8',
  })
  return blob.url
}

/** Blob URLs are public when stored with access: 'public'. */
export function getPublicOrSignedUrl(url: string): string {
  return url
}

export { STORAGE_ROOT, LOCAL_FILES_PREFIX }
