import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessGraph, roleAtLeast } from '@/lib/hubAccess'
import { prepareSourceIngest, extractSourceBatch } from '@/lib/graph/ingest'
import { BATCH_DELAY_MS } from '@/lib/graph/extract'

export const runtime = 'nodejs'
export const maxDuration = 120

function isGraphSchemaError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err)
  return /no such table: SourceDocument|no such table: GraphNode/i.test(msg)
}

async function hubHintsFor(branchId: string): Promise<string | undefined> {
  const layers = await prisma.knowledgeLayer.findMany({
    where: { branchId, enabled: true },
    select: { type: true, name: true, content: true },
    take: 5,
  })
  const hints = layers.map(l => `[${l.type}] ${l.name}: ${l.content.slice(0, 300)}`).join('\n')
  return hints || undefined
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { sourceId } = await params

  let body: { phase?: string; batchIndex?: number } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  try {
    const source = await prisma.sourceDocument.findUnique({ where: { id: sourceId } })
    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const access = await canAccessGraph(session.user.id, source.branchId, 'moderator')
    if (!access.ok || !roleAtLeast(access.role, 'moderator')) {
      return NextResponse.json({ error: 'Read-only: you are a viewer on this hub' }, { status: 403 })
    }

    const hints = await hubHintsFor(source.branchId)
    const phase = body.phase || 'full'

    if (phase === 'prepare') {
      const result = await prepareSourceIngest(sourceId)
      return NextResponse.json({ ok: true, phase: 'prepare', ...result })
    }

    if (phase === 'batch') {
      const batchIndex = typeof body.batchIndex === 'number' ? body.batchIndex : 0
      const result = await extractSourceBatch(sourceId, batchIndex, hints)
      return NextResponse.json({ ok: true, phase: 'batch', ...result })
    }

    // Legacy single-shot: prepare + all batches (may timeout on large docs)
    const prep = await prepareSourceIngest(sourceId)
    let last = null
    for (let i = 0; i < prep.totalBatches; i++) {
      if (i > 0 && BATCH_DELAY_MS > 0) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
      }
      last = await extractSourceBatch(sourceId, i, hints)
    }
    return NextResponse.json({
      ok: true,
      chunkCount: prep.chunkCount,
      topicCount: last?.knowledgeNodeCount ?? 0,
    })
  } catch (err) {
    if (isGraphSchemaError(err)) {
      return NextResponse.json(
        { error: 'Knowledge graph schema not migrated. Run npm run db:migrate:graph.' },
        { status: 503 }
      )
    }
    console.error('graph ingest error:', err)
    const message = err instanceof Error ? err.message : 'Ingest failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
