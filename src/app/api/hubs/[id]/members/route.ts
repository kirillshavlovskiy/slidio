import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHubRole, type HubRole } from '@/lib/hubAccess'

type Ctx = { params: { id: string } }

const ROLES: HubRole[] = ['owner', 'editor', 'viewer']
const coerceRole = (r: unknown): HubRole =>
  ROLES.includes(r as HubRole) ? (r as HubRole) : 'editor'

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = await getHubRole(session.user.id, params.id)
  if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [members, invites] = await Promise.all([
    prisma.hubMember.findMany({
      where: { hubId: params.id },
      include: { user: { select: { email: true, name: true, image: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.hubInvite.findMany({
      where: { hubId: params.id, status: 'pending' },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  return NextResponse.json({
    myRole: role,
    members: members.map(m => ({
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      image: m.user.image,
      role: m.role,
      isMe: m.userId === session.user!.id,
    })),
    invites: invites.map(i => ({ id: i.id, email: i.email, role: i.role })),
  })
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((await getHubRole(session.user.id, params.id)) !== 'owner') {
    return NextResponse.json({ error: 'Only the owner can manage members' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const role = coerceRole(body.role)
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

  const selfEmail = session.user.email?.trim().toLowerCase()
  if (selfEmail && email === selfEmail) {
    return NextResponse.json({ error: 'You cannot invite yourself' }, { status: 400 })
  }

  const existingUser = await prisma.user.findUnique({ where: { email } })
  if (existingUser) {
    const already = await prisma.hubMember.findUnique({
      where: { hubId_userId: { hubId: params.id, userId: existingUser.id } },
    })
    if (already) {
      return NextResponse.json({ error: 'Already a member of this hub' }, { status: 409 })
    }
  }

  await prisma.hubInvite.upsert({
    where: { hubId_email: { hubId: params.id, email } },
    update: { role, status: 'pending', invitedById: session.user.id },
    create: {
      hubId: params.id,
      email,
      role,
      token: randomUUID(),
      invitedById: session.user.id,
      status: 'pending',
    },
  })
  return NextResponse.json({ invited: true })
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((await getHubRole(session.user.id, params.id)) !== 'owner') {
    return NextResponse.json({ error: 'Only the owner can manage members' }, { status: 403 })
  }
  const { userId, role } = await req.json()
  const newRole = coerceRole(role)

  if (newRole !== 'owner') {
    const owners = await prisma.hubMember.count({ where: { hubId: params.id, role: 'owner' } })
    const target = await prisma.hubMember.findUnique({
      where: { hubId_userId: { hubId: params.id, userId } },
    })
    if (target?.role === 'owner' && owners <= 1) {
      return NextResponse.json({ error: 'A hub must keep at least one owner' }, { status: 409 })
    }
  }

  await prisma.hubMember.update({
    where: { hubId_userId: { hubId: params.id, userId } },
    data: { role: newRole },
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const myRole = await getHubRole(session.user.id, params.id)
  if (!myRole) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { userId, inviteId } = await req.json()

  if (inviteId) {
    if (myRole !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await prisma.hubInvite.deleteMany({ where: { id: inviteId, hubId: params.id } })
    return NextResponse.json({ ok: true })
  }

  const removingSelf = userId === session.user.id
  if (myRole !== 'owner' && !removingSelf) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const owners = await prisma.hubMember.count({ where: { hubId: params.id, role: 'owner' } })
  const target = await prisma.hubMember.findUnique({
    where: { hubId_userId: { hubId: params.id, userId } },
  })
  if (target?.role === 'owner' && owners <= 1) {
    return NextResponse.json({ error: 'A hub must keep at least one owner' }, { status: 409 })
  }
  await prisma.hubMember.deleteMany({ where: { hubId: params.id, userId } })
  return NextResponse.json({ ok: true })
}
