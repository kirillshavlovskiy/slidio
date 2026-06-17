import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  accessibleHubIds,
  canAccessKnowledgeLayer,
  getHubRole,
  roleAtLeast,
} from '@/lib/hubAccess'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const branchId = req.nextUrl.searchParams.get('branchId') || undefined

  if (branchId) {
    const role = await getHubRole(session.user.id, branchId)
    if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const layers = await prisma.knowledgeLayer.findMany({
      where: { branchId },
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

  const hubIds = await accessibleHubIds(session.user.id)
  const layers = await prisma.knowledgeLayer.findMany({
    where: {
      OR: [{ userId: session.user.id, branchId: null }, { branchId: { in: hubIds } }],
    },
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

  if (branchId) {
    const role = await getHubRole(session.user.id, branchId)
    if (!roleAtLeast(role, 'editor')) {
      return NextResponse.json({ error: 'Read-only: you are a viewer on this hub' }, { status: 403 })
    }
  }

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

  const existing = await prisma.knowledgeLayer.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const access = await canAccessKnowledgeLayer(session.user.id, existing)
  if (!access.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (access.readOnly) {
    return NextResponse.json({ error: 'Read-only: you are a viewer on this hub' }, { status: 403 })
  }

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

  const existing = await prisma.knowledgeLayer.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const access = await canAccessKnowledgeLayer(session.user.id, existing)
  if (!access.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (access.readOnly) {
    return NextResponse.json({ error: 'Read-only: you are a viewer on this hub' }, { status: 403 })
  }

  await prisma.knowledgeLayer.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
