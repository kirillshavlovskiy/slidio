import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessPresentation, roleAtLeast } from '@/lib/hubAccess'
import {
  mapPresentationDeck,
  getDeckMappingSummary,
  syncDeckProjection,
  prepareDeckMapping,
  mapDeckSlideBatch,
  finalizeDeckMapping,
} from '@/lib/graph/deckMap'
import type { SlideData } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 300

function isGraphSchemaError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err)
  return /Unknown argument `(presentationId|sourceDocumentId)`|no such column:.*(presentationId|sourceDocumentId)/i.test(msg)
}

async function loadPresentation(presentationId: string) {
  return prisma.presentation.findUnique({
    where: { id: presentationId },
    select: { id: true, name: true, branchId: true, slides: true },
  })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ presentationId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { presentationId } = await params
  const access = await canAccessPresentation(session.user.id, presentationId)
  if (!access.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const pres = await loadPresentation(presentationId)
    const summary = await getDeckMappingSummary(presentationId, pres?.branchId ?? undefined)
    return NextResponse.json(summary ?? { presentationId, mappingCount: 0, mappings: [] })
  } catch (err) {
    if (isGraphSchemaError(err)) {
      return NextResponse.json(
        { error: 'Graph schema not migrated. Run npm run db:migrate:graph.' },
        { status: 503 }
      )
    }
    throw err
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ presentationId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { presentationId } = await params
  const access = await canAccessPresentation(session.user.id, presentationId)
  if (!access.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!roleAtLeast(access.role, 'editor')) {
    return NextResponse.json({ error: 'Read-only: you are a viewer on this hub' }, { status: 403 })
  }

  let body: { projectOnly?: boolean; phase?: string; slideIndex?: number } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  try {
    const pres = await loadPresentation(presentationId)
    if (!pres?.branchId) {
      return NextResponse.json(
        { error: 'Presentation must belong to a Knowledge Hub to map to the graph' },
        { status: 400 }
      )
    }

    const slides = JSON.parse(pres.slides || '[]') as SlideData[]
    const phase = body.phase || (body.projectOnly ? 'projectOnly' : 'full')

    if (phase === 'projectOnly') {
      const projected = await syncDeckProjection({
        branchId: pres.branchId,
        presentationId: pres.id,
        presentationName: pres.name,
        slides,
      })
      return NextResponse.json({
        ok: true,
        projectOnly: true,
        slideCount: projected.slideCount,
        elementCount: projected.elementCount,
      })
    }

    if (phase === 'prepare') {
      const result = await prepareDeckMapping({
        branchId: pres.branchId,
        presentationId: pres.id,
        presentationName: pres.name,
        slides,
      })
      return NextResponse.json({ ok: true, phase: 'prepare', ...result })
    }

    if (phase === 'batch') {
      const slideIndex = typeof body.slideIndex === 'number' ? body.slideIndex : 0
      const result = await mapDeckSlideBatch({
        branchId: pres.branchId,
        presentationId: pres.id,
        slides,
        slideIndex,
      })
      return NextResponse.json({ ok: true, phase: 'batch', ...result })
    }

    if (phase === 'finalize') {
      const result = await finalizeDeckMapping({
        branchId: pres.branchId,
        presentationId: pres.id,
        presentationName: pres.name,
      })
      return NextResponse.json({ ok: true, phase: 'finalize', ...result })
    }

    // Legacy single-shot — only for tiny decks; batched flow is used by the UI.
    if (slides.length > 5) {
      return NextResponse.json(
        {
          error:
            'Deck has too many slides for a single mapping request. The UI maps one slide per request automatically — refresh and try again.',
        },
        { status: 400 }
      )
    }

    const result = await mapPresentationDeck({
      branchId: pres.branchId,
      presentationId: pres.id,
      presentationName: pres.name,
      slides,
    })

    return NextResponse.json({
      ok: true,
      slideCount: result.projected.slideCount,
      elementCount: result.projected.elementCount,
      mappingCount: result.mappingCount,
      elementMappings: result.elementMappings.length,
      slideTopics: result.slideTopics.length,
    })
  } catch (err) {
    if (isGraphSchemaError(err)) {
      return NextResponse.json(
        { error: 'Graph schema not migrated. Run npm run db:migrate:graph.' },
        { status: 503 }
      )
    }
    console.error('deck map error:', err)
    const message = err instanceof Error ? err.message : 'Deck mapping failed'
    const status = /timed out/i.test(message) ? 504 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
