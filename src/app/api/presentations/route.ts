import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const branchId = req.nextUrl.searchParams.get('branchId') || undefined
  const presentations = await prisma.presentation.findMany({
    where: { userId: session.user.id, ...(branchId ? { branchId } : {}) },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, name: true, branchId: true, updatedAt: true, createdAt: true },
  })
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
    const existing = await prisma.presentation.findFirst({
      where: { id, userId: session.user.id },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const presentation = await prisma.presentation.update({
      where: { id },
      data,
    })
    return NextResponse.json({ id: presentation.id })
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
