import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const branchId = req.nextUrl.searchParams.get('branchId') || undefined
  const layers = await prisma.knowledgeLayer.findMany({
    where: { userId: session.user.id, ...(branchId ? { branchId } : {}) },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(
    layers.map(layer => ({
      ...layer,
      createdAt: new Date(layer.createdAt).getTime(),
      updatedAt: new Date(layer.updatedAt).getTime(),
    }))
  )
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { type, name, content, enabled, source, branchId } = await req.json()
  const layer = await prisma.knowledgeLayer.create({
    data: {
      userId: session.user.id,
      branchId: (branchId as string) ?? null,
      type,
      name,
      content,
      enabled: enabled ?? true,
      source: source || 'manual',
    },
  })
  return NextResponse.json({
    ...layer,
    createdAt: new Date(layer.createdAt).getTime(),
    updatedAt: new Date(layer.updatedAt).getTime(),
  })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, type, name, content, enabled, source } = await req.json()

  const existing = await prisma.knowledgeLayer.findFirst({
    where: { id, userId: session.user.id },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Whitelist mutable columns only. The client model carries createdAt/updatedAt as
  // epoch ints and immutable keys (userId, branchId) — spreading those into update()
  // makes Prisma reject the Int where it expects DateTime.
  const layer = await prisma.knowledgeLayer.update({
    where: { id },
    data: {
      ...(type !== undefined ? { type } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(source !== undefined ? { source } : {}),
      updatedAt: new Date(),
    },
  })
  return NextResponse.json({
    ...layer,
    createdAt: new Date(layer.createdAt).getTime(),
    updatedAt: new Date(layer.updatedAt).getTime(),
  })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json()

  const existing = await prisma.knowledgeLayer.findFirst({
    where: { id, userId: session.user.id },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.knowledgeLayer.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
