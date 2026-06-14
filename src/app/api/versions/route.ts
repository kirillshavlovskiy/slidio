import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const {
    id, presentationId, label, changeLog, slides, decisionId, slideCount, changedSlideIds,
    branchId, branchLabel, parentVersionId, isBranchRoot,
  } = await req.json()

  const presentation = await prisma.presentation.findFirst({
    where: { id: presentationId, userId: session.user.id },
  })
  if (!presentation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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
  }

  // Idempotent on a client-supplied id so the local snapshot and the DB row share
  // one id — no post-hoc id swap, and a retry overwrites rather than duplicates.
  const version = id
    ? await prisma.slideVersion.upsert({
        where: { id },
        update: {
          label: label || null, changeLog, slides: JSON.stringify(slides), slideCount,
          changedSlideIds: JSON.stringify(changedSlideIds ?? []),
          branchId: branchId ?? null, branchLabel: branchLabel ?? null,
          parentVersionId: parentVersionId ?? null, isBranchRoot: !!isBranchRoot,
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
    where: { id, presentation: { userId: session.user.id } },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const version = await prisma.slideVersion.update({ where: { id }, data: { label } })
  return NextResponse.json({ id: version.id })
}
