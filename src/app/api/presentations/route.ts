import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessPresentation, getHubRole, canEditPresentation } from '@/lib/hubAccess'

function isUnknownEditorSessionFieldError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /Unknown argument [`']?editorSession[`']?/i.test(err.message)
  )
}

async function updatePresentation(
  id: string,
  data: Prisma.PresentationUncheckedUpdateInput
): Promise<{ id: string }> {
  try {
    const presentation = await prisma.presentation.update({ where: { id }, data })
    return { id: presentation.id }
  } catch (err) {
    // Stale Prisma client in a long-running dev server may not know editorSession yet.
    if (isUnknownEditorSessionFieldError(err) && data.editorSession !== undefined) {
      const { editorSession: _drop, ...rest } = data
      const presentation = await prisma.presentation.update({ where: { id }, data: rest })
      console.warn(
        '[presentations] editorSession skipped — restart dev server after prisma generate'
      )
      return { id: presentation.id }
    }
    throw err
  }
}

async function listPresentations(userId: string, branchId?: string) {
  const select = {
    id: true,
    name: true,
    branchId: true,
    updatedAt: true,
    createdAt: true,
  } as const

  if (branchId) {
    return prisma.presentation.findMany({
      where: { branchId },
      orderBy: { updatedAt: 'desc' },
      select,
    })
  }

  // Always include decks the user created. Also include decks on hubs they can access.
  try {
    return await prisma.presentation.findMany({
      where: {
        OR: [
          { userId },
          { branch: { OR: [{ userId }, { members: { some: { userId } } }] } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      select,
    })
  } catch {
    // Pre-migration: user-owned decks only (legacy behavior).
    return prisma.presentation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select,
    })
  }
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const branchId = req.nextUrl.searchParams.get('branchId') || undefined

  const presentations = await listPresentations(session.user.id, branchId)

  if (branchId && !(await getHubRole(session.user.id, branchId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json(presentations)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, name, branchId, slides, conversationHistory, activeSlideId, editorSession } =
    await req.json()

  const data: Prisma.PresentationUncheckedUpdateInput = {
    updatedAt: new Date(),
  }
  if (name !== undefined) data.name = name || 'Untitled Presentation'
  if (branchId !== undefined) data.branchId = branchId
  if (slides !== undefined) data.slides = JSON.stringify(slides)
  if (conversationHistory !== undefined) {
    data.conversationHistory = JSON.stringify(conversationHistory)
  }
  if (activeSlideId !== undefined) data.activeSlideId = activeSlideId
  if (editorSession !== undefined) {
    data.editorSession =
      editorSession && typeof editorSession === 'object'
        ? JSON.stringify(editorSession)
        : '{}'
  }

  if (id) {
    const access = await canAccessPresentation(session.user.id, id)
    if (!access.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!canEditPresentation(access.role)) {
      return NextResponse.json({ error: 'Read-only: you cannot edit decks on this hub' }, { status: 403 })
    }

    const presentation = await updatePresentation(id, data)
    return NextResponse.json({ id: presentation.id })
  }

  if (branchId && !(await getHubRole(session.user.id, branchId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const hubRole = branchId ? await getHubRole(session.user.id, branchId) : null
  if (hubRole && !canEditPresentation(hubRole)) {
    return NextResponse.json({ error: 'Read-only: you cannot edit decks on this hub' }, { status: 403 })
  }

  const presentation = await prisma.presentation.create({
    data: {
      userId: session.user.id,
      branchId: (branchId as string) ?? null,
      name: (name as string) || 'Untitled Presentation',
      slides: JSON.stringify(slides ?? []),
      conversationHistory: JSON.stringify(conversationHistory ?? []),
      activeSlideId: activeSlideId ?? null,
      updatedAt: new Date(),
    },
  })
  return NextResponse.json({ id: presentation.id })
}
