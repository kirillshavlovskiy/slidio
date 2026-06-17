import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHubRole } from '@/lib/hubAccess'

const branchInclude = {
  _count: { select: { presentations: true } },
  knowledgeLayers: {
    orderBy: { updatedAt: 'desc' as const },
    select: { id: true, name: true, type: true, enabled: true, source: true },
  },
}

async function fetchBranchesForUser(userId: string) {
  // Prefer relation-based query (owned + shared). Fall back to owned-only when
  // collaboration tables haven't been migrated on production yet.
  try {
    return await prisma.knowledgeBranch.findMany({
      where: {
        OR: [{ userId }, { members: { some: { userId } } }],
      },
      orderBy: { updatedAt: 'desc' },
      include: branchInclude,
    })
  } catch {
    return await prisma.knowledgeBranch.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: branchInclude,
    })
  }
}

/**
 * Ensure the user has at least one knowledge branch. On first run we create a
 * "Default" branch and adopt every branch-less presentation + knowledge layer
 * the user already owns, so existing data keeps its shared knowledge.
 */
async function ensureDefaultBranch(userId: string): Promise<void> {
  const count = await prisma.knowledgeBranch.count({ where: { userId } })
  if (count > 0) return

  const branch = await prisma.knowledgeBranch.create({
    data: { userId, name: 'Default Branch' },
  })
  await prisma.presentation.updateMany({
    where: { userId, branchId: null },
    data: { branchId: branch.id },
  })
  await prisma.knowledgeLayer.updateMany({
    where: { userId, branchId: null },
    data: { branchId: branch.id },
  })
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureDefaultBranch(session.user.id)

  const branches = await fetchBranchesForUser(session.user.id)

  const withRoles = await Promise.all(
    branches.map(async b => ({
      id: b.id,
      name: b.name,
      presentationCount: b._count.presentations,
      knowledgeLayers: b.knowledgeLayers.map(l => ({
        id: l.id,
        name: l.name,
        type: l.type,
        enabled: l.enabled,
        source: l.source,
      })),
      role: await getHubRole(session.user!.id, b.id),
      isOwner: b.userId === session.user!.id,
      createdAt: new Date(b.createdAt).getTime(),
      updatedAt: new Date(b.updatedAt).getTime(),
    }))
  )
  return NextResponse.json(withRoles)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name } = await req.json()
  const branch = await prisma.knowledgeBranch.create({
    data: { userId: session.user.id, name: (name as string)?.trim() || 'Untitled Branch' },
  })
  return NextResponse.json({ id: branch.id, name: branch.name, presentationCount: 0 })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, name } = await req.json()
  if ((await getHubRole(session.user.id, id)) !== 'owner') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const existing = await prisma.knowledgeBranch.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const branch = await prisma.knowledgeBranch.update({
    where: { id },
    data: { name: (name as string)?.trim() || existing.name, updatedAt: new Date() },
  })
  return NextResponse.json({ id: branch.id, name: branch.name })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  if ((await getHubRole(session.user.id, id)) !== 'owner') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const existing = await prisma.knowledgeBranch.findUnique({
    where: { id },
    include: { _count: { select: { presentations: true } } },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing._count.presentations > 0) {
    return NextResponse.json({ error: 'Branch still has presentations' }, { status: 409 })
  }

  await prisma.knowledgeBranch.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
