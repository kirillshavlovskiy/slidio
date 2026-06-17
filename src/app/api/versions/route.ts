import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessPresentation } from '@/lib/hubAccess'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const {
    id, presentationId, label, changeLog, slides, decisionId, slideCount, changedSlideIds,
    branchId, branchLabel, parentVersionId, isBranchRoot,
  } = await req.json()

  const access = await canAccessPresentation(session.user.id, presentationId)
  if (!access.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (access.role === 'viewer') {
    return NextResponse.json({ error: 'Read-only: you are a viewer on this hub' }, { status: 403 })
  }

  const createData = {
    ...(id ? { id } : {}),
    presentationId,
    label: label || null,
    changeLog,
    slides: JSON.stringify(slides),
    decisionId: decisionId || null,
    slideCount,
    changedSlideIds: JSON.stringify(changedSlideIds ?? []),
    branchId: branchId ?? null,
    branchLabel: branchLabel ?? null,
    parentVersionId: parentVersionId ?? null,
    isBranchRoot: !!isBranchRoot,
    actorId: session.user.id,
  }

  const version = id
    ? await prisma.slideVersion.upsert({
        where: { id },
        update: {
          label: label || null, changeLog, slides: JSON.stringify(slides), slideCount,
          changedSlideIds: JSON.stringify(changedSlideIds ?? []),
          branchId: branchId ?? null, branchLabel: branchLabel ?? null,
          parentVersionId: parentVersionId ?? null, isBranchRoot: !!isBranchRoot,
          actorId: session.user.id,
        },
        create: createData,
      })
    : await prisma.slideVersion.create({ data: createData })
  return NextResponse.json({ id: version.id, createdAt: version.createdAt })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, label } = await req.json()

  const existing = await prisma.slideVersion.findFirst({
    where: { id },
    include: { presentation: { select: { id: true } } },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const access = await canAccessPresentation(session.user.id, existing.presentationId)
  if (!access.ok || access.role === 'viewer') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const version = await prisma.slideVersion.update({ where: { id }, data: { label } })
  return NextResponse.json({ id: version.id })
}
