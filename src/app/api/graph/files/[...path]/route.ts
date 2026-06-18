import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { STORAGE_ROOT } from '@/lib/blobStorage'

export const runtime = 'nodejs'

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.txt') return 'text/plain; charset=utf-8'
  if (ext === '.pdf') return 'application/pdf'
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (ext === '.json') return 'application/json'
  if (ext === '.csv') return 'text/csv'
  return 'application/octet-stream'
}

/** Serve locally stored graph source files (dev fallback when Blob token is unset). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params
  const rel = segments.join('/')
  const root = STORAGE_ROOT()
  const abs = path.resolve(root, rel)
  const rootWithSep = root + path.sep

  if (!abs.startsWith(rootWithSep) && abs !== root) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const data = await fs.readFile(abs)
    return new NextResponse(data, {
      headers: {
        'Content-Type': contentTypeFor(abs),
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
