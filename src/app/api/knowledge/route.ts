import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { accessibleHubIds, canAccessKnowledgeLayer, getHubRole, canModerateKnowledge } from '@/lib/hubAccess'
import { actorDisplayName } from '@/lib/actorInfo'
import { clampTextLayerContent, isKbTextLayerType, TEXT_LAYER_MAX_CHARS } from '@/lib/knowledge'

const layerUserSelect = { select: { name: true, email: true, image: true } } as const

function mapLayer(layer: {
  id: string
  userId: string
  branchId: string | null
  type: string
  name: string
  content: string
  enabled: boolean
  source: string | null
  createdAt: Date
  updatedAt: Date
  user?: { name: string | null; email: string | null; image: string | null }
}) {
  return {
    id: layer.id,
    userId: layer.userId,
    branchId: layer.branchId,
    type: layer.type,
    name: layer.name,
    content: layer.content,
    enabled: layer.enabled,
    source: layer.source,
    updatedByName: layer.user ? actorDisplayName(layer.user.name, layer.user.email) : undefined,
    updatedByImage: layer.user?.image ?? null,
    createdAt: new Date(layer.createdAt).getTime(),
    updatedAt: new Date(layer.updatedAt).getTime(),
  }
}

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
      include: { user: layerUserSelect },
    })
    return NextResponse.json(layers.map(mapLayer))
  }

  const hubIds = await accessibleHubIds(session.user.id)
  const layers = await prisma.knowledgeLayer.findMany({
    where: {
      OR: [{ userId: session.user.id, branchId: null }, { branchId: { in: hubIds } }],
    },
    orderBy: { createdAt: 'asc' },
    include: { user: layerUserSelect },
  })
  return NextResponse.json(layers.map(mapLayer))
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { type, name, content, enabled, source, branchId } = await req.json()

  if (branchId) {
    const role = await getHubRole(session.user.id, branchId)
    if (!canModerateKnowledge(role)) {
      return NextResponse.json({ error: 'Read-only: you cannot edit knowledge on this hub' }, { status: 403 })
    }
  }

  const layerSource = source || 'manual'
  if (
    layerSource === 'manual' &&
    typeof type === 'string' &&
    isKbTextLayerType(type) &&
    typeof content === 'string' &&
    content.length > TEXT_LAYER_MAX_CHARS
  ) {
    return NextResponse.json(
      { error: `KB text layers are limited to ${TEXT_LAYER_MAX_CHARS} characters (~300 tokens). Use Documents for full files.` },
      { status: 400 }
    )
  }

  const layer = await prisma.knowledgeLayer.create({
    data: {
      userId: session.user.id,
      branchId: (branchId as string) ?? null,
      type,
      name,
      content: layerSource === 'document' ? content : clampTextLayerContent(String(content ?? '')),
      enabled: enabled ?? true,
      source: layerSource,
    },
    include: { user: layerUserSelect },
  })
  return NextResponse.json(mapLayer(layer))
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
    return NextResponse.json({ error: 'Read-only: you cannot edit knowledge on this hub' }, { status: 403 })
  }

  const nextType = type !== undefined ? type : existing.type
  const nextSource = source !== undefined ? source : existing.source
  const nextContent = content !== undefined ? content : existing.content
  if (
    nextSource !== 'document' &&
    isKbTextLayerType(String(nextType)) &&
    typeof nextContent === 'string' &&
    nextContent.length > TEXT_LAYER_MAX_CHARS
  ) {
    return NextResponse.json(
      { error: `KB text layers are limited to ${TEXT_LAYER_MAX_CHARS} characters (~300 tokens).` },
      { status: 400 }
    )
  }

  const layer = await prisma.knowledgeLayer.update({
    where: { id },
    data: {
      ...(type !== undefined ? { type } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(content !== undefined
        ? {
            content:
              (source !== undefined ? source : existing.source) === 'document'
                ? content
                : clampTextLayerContent(String(content)),
          }
        : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(source !== undefined ? { source } : {}),
      userId: session.user.id,
      updatedAt: new Date(),
    },
    include: { user: layerUserSelect },
  })
  return NextResponse.json(mapLayer(layer))
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
    return NextResponse.json({ error: 'Read-only: you cannot edit knowledge on this hub' }, { status: 403 })
  }

  await prisma.knowledgeLayer.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
