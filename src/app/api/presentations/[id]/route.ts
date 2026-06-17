import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { normalizeConversationHistory } from '@/lib/conversation'
import { canAccessPresentation, getHubRole, roleAtLeast } from '@/lib/hubAccess'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await canAccessPresentation(session.user.id, params.id)
  if (!access.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const p = await prisma.presentation.findUnique({
    where: { id: params.id },
    include: {
      versions: { orderBy: { createdAt: 'asc' } },
      decisions: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let conversationHistory: unknown[] = []
  try {
    conversationHistory = normalizeConversationHistory(JSON.parse(p.conversationHistory))
  } catch {
    conversationHistory = []
  }

  return NextResponse.json({
    id: p.id,
    name: p.name,
    branchId: p.branchId,
    myRole: access.role,
    activeSlideId: p.activeSlideId,
    slides: JSON.parse(p.slides),
    conversationHistory,
    versions: p.versions.map(v => ({
      id: v.id,
      label: v.label,
      changeLog: v.changeLog,
      slides: JSON.parse(v.slides),
      decisionId: v.decisionId,
      slideCount: v.slideCount,
      changedSlideIds: JSON.parse(v.changedSlideIds),
      branchId: v.branchId,
      branchLabel: v.branchLabel,
      parentVersionId: v.parentVersionId,
      isBranchRoot: v.isBranchRoot,
      actorId: v.actorId,
      createdAt: v.createdAt,
      timestamp: new Date(v.createdAt).getTime(),
    })),
    decisions: p.decisions.map(d => ({
      id: d.id,
      instruction: d.instruction,
      proposedSummary: d.proposedSummary,
      proposedChanges: JSON.parse(d.proposedChanges),
      status: d.status,
      slideIds: JSON.parse(d.slideIds),
      selectedElementIds: JSON.parse(d.selectedElementIds),
      snapshotBefore: d.snapshotBefore ? JSON.parse(d.snapshotBefore) : undefined,
      actorId: d.actorId,
      createdAt: d.createdAt,
      timestamp: new Date(d.createdAt).getTime(),
    })),
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pres = await prisma.presentation.findUnique({
    where: { id: params.id },
    select: { userId: true, branchId: true },
  })
  if (!pres) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const canDelete =
    pres.userId === session.user.id ||
    (pres.branchId && roleAtLeast(await getHubRole(session.user.id, pres.branchId), 'owner'))
  if (!canDelete) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.presentation.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
