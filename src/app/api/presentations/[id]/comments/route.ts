import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { actorDisplayName } from '@/lib/actorInfo'
import { clampCommentContent, MAX_COMMENT_CHARS } from '@/lib/comments'
import { canAccessPresentation, canEditPresentation } from '@/lib/hubAccess'

type Ctx = { params: { id: string } }

function isCommentsSchemaError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err)
  return /no such table: DeckComment|no such column: pinX|no such column: pinY/i.test(msg)
}

function parsePin(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.min(960, Math.max(0, v))
}

function mapComment(
  c: {
    id: string
    presentationId: string
    userId: string
    slideId: string | null
    elementId: string | null
    pinX?: number | null
    pinY?: number | null
    content: string
    resolved: boolean
    createdAt: Date
    updatedAt: Date
    user: { name: string | null; email: string | null; image: string | null }
  },
  sessionUserId: string
) {
  return {
    id: c.id,
    presentationId: c.presentationId,
    userId: c.userId,
    authorName: actorDisplayName(c.user.name, c.user.email),
    authorEmail: c.user.email,
    authorImage: c.user.image,
    slideId: c.slideId,
    elementId: c.elementId,
    pinX: c.pinX ?? null,
    pinY: c.pinY ?? null,
    content: c.content,
    resolved: c.resolved,
    createdAt: new Date(c.createdAt).getTime(),
    updatedAt: new Date(c.updatedAt).getTime(),
    isMe: c.userId === sessionUserId,
  }
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await canAccessPresentation(session.user.id, params.id)
  if (!access.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const comments = await prisma.deckComment.findMany({
      where: { presentationId: params.id },
      include: { user: { select: { name: true, email: true, image: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json(comments.map(c => mapComment(c, session.user!.id)))
  } catch (err) {
    if (isCommentsSchemaError(err)) return NextResponse.json([])
    throw err
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await canAccessPresentation(session.user.id, params.id)
  if (!access.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const raw = typeof body.content === 'string' ? body.content : ''
  const content = clampCommentContent(raw)
  if (!content) return NextResponse.json({ error: 'Comment required' }, { status: 400 })
  if (raw.length > MAX_COMMENT_CHARS) {
    return NextResponse.json({ error: `Comment max ${MAX_COMMENT_CHARS} characters` }, { status: 400 })
  }

  const slideId = typeof body.slideId === 'string' ? body.slideId : null
  const elementId = typeof body.elementId === 'string' ? body.elementId : null
  const pinX = parsePin(body.pinX)
  const pinY = parsePin(body.pinY)

  try {
    const comment = await prisma.deckComment.create({
      data: {
        presentationId: params.id,
        userId: session.user.id,
        slideId,
        elementId,
        pinX,
        pinY,
        content,
      },
      include: { user: { select: { name: true, email: true, image: true } } },
    })
    return NextResponse.json(mapComment(comment, session.user.id))
  } catch (err) {
    if (isCommentsSchemaError(err)) {
      return NextResponse.json(
        { error: 'Comments not migrated yet. Run: node scripts/migrate-comments.mjs' },
        { status: 503 }
      )
    }
    throw err
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await canAccessPresentation(session.user.id, params.id)
  if (!access.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const { id, content, resolved } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  try {
    const existing = await prisma.deckComment.findFirst({
      where: { id, presentationId: params.id },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const isAuthor = existing.userId === session.user.id

    if (content !== undefined) {
      if (!isAuthor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      const next = clampCommentContent(String(content))
      if (!next) return NextResponse.json({ error: 'Comment required' }, { status: 400 })
    }

    // Anyone with deck access can resolve/reopen comments (viewers included).
    const comment = await prisma.deckComment.update({
      where: { id },
      data: {
        ...(content !== undefined ? { content: clampCommentContent(String(content)) } : {}),
        ...(resolved !== undefined ? { resolved: !!resolved } : {}),
        updatedAt: new Date(),
      },
      include: { user: { select: { name: true, email: true, image: true } } },
    })
    return NextResponse.json(mapComment(comment, session.user.id))
  } catch (err) {
    if (isCommentsSchemaError(err)) {
      return NextResponse.json({ error: 'Comments not migrated' }, { status: 503 })
    }
    throw err
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await canAccessPresentation(session.user.id, params.id)
  if (!access.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const { id } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  try {
    const existing = await prisma.deckComment.findFirst({
      where: { id, presentationId: params.id },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const isAuthor = existing.userId === session.user.id
    if (!isAuthor && !canEditPresentation(access.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await prisma.deckComment.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (isCommentsSchemaError(err)) {
      return NextResponse.json({ error: 'Comments not migrated' }, { status: 503 })
    }
    throw err
  }
}
