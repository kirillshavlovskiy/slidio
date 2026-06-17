import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { accessibleHubIds, canAccessPresentation, getHubRole } from '@/lib/hubAccess'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const branchId = req.nextUrl.searchParams.get('branchId') || undefined

  const hubIds = await accessibleHubIds(session.user.id)
  const presentations = await prisma.presentation.findMany({
    where: branchId
      ? { branchId }
      : {
          OR: [{ userId: session.user.id }, { branchId: { in: hubIds } }],
        },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, name: true, branchId: true, updatedAt: true, createdAt: true },
  })

  if (branchId && !(await getHubRole(session.user.id, branchId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json(presentations)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, name, branchId, slides, conversationHistory, activeSlideId } = await req.json()

  const data: Record<string, unknown> = {
    updatedAt: new Date(),
  }
  if (name !== undefined) data.name = name || 'Untitled Presentation'
  if (branchId !== undefined) data.branchId = branchId
  if (slides !== undefined) data.slides = JSON.stringify(slides)
  if (conversationHistory !== undefined) {
    data.conversationHistory = JSON.stringify(conversationHistory)
  }
  if (activeSlideId !== undefined) data.activeSlideId = activeSlideId

  if (id) {
    const access = await canAccessPresentation(session.user.id, id)
    if (!access.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (access.role === 'viewer') {
      return NextResponse.json({ error: 'Read-only: you are a viewer on this hub' }, { status: 403 })
    }

    const presentation = await prisma.presentation.update({
      where: { id },
      data,
    })
    return NextResponse.json({ id: presentation.id })
  }

  if (branchId && !(await getHubRole(session.user.id, branchId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const hubRole = branchId ? await getHubRole(session.user.id, branchId) : null
  if (hubRole === 'viewer') {
    return NextResponse.json({ error: 'Read-only: you are a viewer on this hub' }, { status: 403 })
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
