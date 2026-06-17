import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessPresentation } from '@/lib/hubAccess'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const {
    id,
    presentationId,
    instruction,
    proposedSummary,
    proposedChanges,
    status,
    rejectionReason,
    slideIds,
    selectedElementIds,
    snapshotBefore,
  } = await req.json()

  const access = await canAccessPresentation(session.user.id, presentationId)
  if (!access.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (access.role === 'viewer') {
    return NextResponse.json({ error: 'Read-only: you are a viewer on this hub' }, { status: 403 })
  }

  const createData = {
    ...(id ? { id } : {}),
    presentationId,
    instruction,
    proposedSummary,
    proposedChanges: JSON.stringify(proposedChanges ?? []),
    status: status || 'pending',
    rejectionReason: rejectionReason || null,
    slideIds: JSON.stringify(slideIds ?? []),
    selectedElementIds: JSON.stringify(selectedElementIds ?? []),
    snapshotBefore: snapshotBefore ? JSON.stringify(snapshotBefore) : null,
    actorId: session.user.id,
  }

  const decision = id
    ? await prisma.decisionRecord.upsert({
        where: { id },
        update: {
          status: status || 'pending',
          ...(rejectionReason !== undefined ? { rejectionReason: rejectionReason || null } : {}),
        },
        create: createData,
      })
    : await prisma.decisionRecord.create({ data: createData })
  return NextResponse.json({ id: decision.id })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, status, rejectionReason } = await req.json()

  const existing = await prisma.decisionRecord.findFirst({
    where: { id },
    select: { presentationId: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const access = await canAccessPresentation(session.user.id, existing.presentationId)
  if (!access.ok || access.role === 'viewer') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma.decisionRecord.update({
    where: { id },
    data: {
      ...(status !== undefined ? { status } : {}),
      ...(rejectionReason !== undefined ? { rejectionReason: rejectionReason || null } : {}),
    },
  })
  return NextResponse.json({ ok: true })
}
