import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessGraph, roleAtLeast } from '@/lib/hubAccess'
import { putSourceFile, putExtractedText } from '@/lib/blobStorage'
import { fileTypeFromName, parseSourceDocument, deleteSourceDocument } from '@/lib/graph/ingest'

export const runtime = 'nodejs'

const MAX_SOURCE_TEXT_CHARS = 200_000

function isGraphSchemaError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err)
  return /no such table: SourceDocument|no such table: GraphNode/i.test(msg)
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const branchId = req.nextUrl.searchParams.get('branchId')
  if (!branchId) return NextResponse.json({ error: 'branchId required' }, { status: 400 })

  const access = await canAccessGraph(session.user.id, branchId, 'viewer')
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const sources = await prisma.sourceDocument.findMany({
      where: { branchId },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(
      sources.map(s => ({
        ...s,
        createdAt: new Date(s.createdAt).getTime(),
        updatedAt: new Date(s.updatedAt).getTime(),
      }))
    )
  } catch (err) {
    if (isGraphSchemaError(err)) {
      return NextResponse.json([])
    }
    throw err
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const contentType = req.headers.get('content-type') || ''

    // Client parses PDF/DOCX in the browser and sends extracted text as JSON so
    // large binaries never hit the ~4.5MB serverless request body limit (HTTP 413).
    if (contentType.includes('application/json')) {
      const body = (await req.json()) as {
        branchId?: string
        title?: string
        fileType?: string
        text?: string
        originalFilename?: string
      }

      const branchId = body.branchId?.trim()
      const title = body.title?.trim()
      const fileType = body.fileType?.trim()
      const text = body.text?.trim()

      if (!branchId) return NextResponse.json({ error: 'branchId required' }, { status: 400 })
      if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })
      if (!fileType || fileType === 'unknown') {
        return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })
      }
      if (!text) {
        return NextResponse.json({ error: 'No readable text in document' }, { status: 400 })
      }
      if (text.length > MAX_SOURCE_TEXT_CHARS) {
        return NextResponse.json(
          { error: `Document text exceeds ${MAX_SOURCE_TEXT_CHARS.toLocaleString()} characters` },
          { status: 400 }
        )
      }

      const access = await canAccessGraph(session.user.id, branchId, 'editor')
      if (!access.ok || !roleAtLeast(access.role, 'editor')) {
        return NextResponse.json({ error: 'Read-only: you are a viewer on this hub' }, { status: 403 })
      }

      const source = await prisma.sourceDocument.create({
        data: {
          branchId,
          title,
          fileType,
          uploadedById: session.user.id,
          blobUrl: '',
          status: 'registered',
        },
      })

      try {
        const extractedUrl = await putExtractedText(branchId, source.id, text)
        await prisma.sourceDocument.update({
          where: { id: source.id },
          data: {
            blobUrl: extractedUrl,
            extractedTextBlobUrl: extractedUrl,
            status: 'parsed',
            error: null,
          },
        })
      } catch (uploadErr) {
        await deleteSourceDocument(source.id).catch(() => {})
        throw uploadErr
      }

      const updated = await prisma.sourceDocument.findUnique({ where: { id: source.id } })
      return NextResponse.json({
        ...updated,
        createdAt: new Date(updated!.createdAt).getTime(),
        updatedAt: new Date(updated!.updatedAt).getTime(),
      })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const branchId = formData.get('branchId') as string | null
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    if (!branchId) return NextResponse.json({ error: 'branchId required' }, { status: 400 })

    const access = await canAccessGraph(session.user.id, branchId, 'editor')
    if (!access.ok || !roleAtLeast(access.role, 'editor')) {
      return NextResponse.json({ error: 'Read-only: you are a viewer on this hub' }, { status: 403 })
    }

    const fileType = fileTypeFromName(file.name)
    if (fileType === 'unknown') {
      return NextResponse.json(
        { error: 'Unsupported file type. Use PDF, DOCX, TXT, MD, CSV, JSON, YAML, HTML or XML.' },
        { status: 400 }
      )
    }

    const title = file.name.replace(/\.[^.]+$/, '')
    const buffer = Buffer.from(await file.arrayBuffer())

    const source = await prisma.sourceDocument.create({
      data: {
        branchId,
        title,
        fileType,
        uploadedById: session.user.id,
        blobUrl: '',
        status: 'registered',
      },
    })

    try {
      const blobUrl = await putSourceFile(branchId, source.id, buffer, file.name)
      await prisma.sourceDocument.update({
        where: { id: source.id },
        data: { blobUrl },
      })

      try {
        await parseSourceDocument(source.id)
      } catch (parseErr) {
        console.error('parseSourceDocument error:', parseErr)
      }
    } catch (uploadErr) {
      await deleteSourceDocument(source.id).catch(() => {})
      throw uploadErr
    }

    const updated = await prisma.sourceDocument.findUnique({ where: { id: source.id } })
    return NextResponse.json({
      ...updated,
      createdAt: new Date(updated!.createdAt).getTime(),
      updatedAt: new Date(updated!.updatedAt).getTime(),
    })
  } catch (err) {
    if (isGraphSchemaError(err)) {
      return NextResponse.json(
        { error: 'Knowledge graph schema not migrated. Run npm run db:migrate:graph.' },
        { status: 503 }
      )
    }
    console.error('graph sources POST error:', err)
    const message = err instanceof Error ? err.message : 'Upload failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sourceId = req.nextUrl.searchParams.get('sourceId')
  if (!sourceId) return NextResponse.json({ error: 'sourceId required' }, { status: 400 })

  try {
    const source = await prisma.sourceDocument.findUnique({ where: { id: sourceId } })
    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const access = await canAccessGraph(session.user.id, source.branchId, 'editor')
    if (!access.ok || !roleAtLeast(access.role, 'editor')) {
      return NextResponse.json({ error: 'Read-only: you are a viewer on this hub' }, { status: 403 })
    }

    await deleteSourceDocument(sourceId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (isGraphSchemaError(err)) {
      return NextResponse.json(
        { error: 'Knowledge graph schema not migrated. Run npm run db:migrate:graph.' },
        { status: 503 }
      )
    }
    console.error('graph sources DELETE error:', err)
    const message = err instanceof Error ? err.message : 'Delete failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
