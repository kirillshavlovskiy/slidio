import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/** Pending hub invites for the signed-in user (matched by account email). */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const email = session.user.email?.trim().toLowerCase()
  if (!email) return NextResponse.json([])

  const invites = await prisma.hubInvite.findMany({
    where: { email, status: 'pending' },
    include: {
      hub: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const inviterIds = [...new Set(invites.map(i => i.invitedById))]
  const inviters = inviterIds.length
    ? await prisma.user.findMany({
        where: { id: { in: inviterIds } },
        select: { id: true, name: true, email: true },
      })
    : []
  const inviterById = new Map(inviters.map(u => [u.id, u]))

  return NextResponse.json(
    invites.map(i => {
      const inviter = inviterById.get(i.invitedById)
      return {
        id: i.id,
        hubId: i.hubId,
        hubName: i.hub.name,
        role: i.role,
        invitedByName: inviter?.name || inviter?.email || 'Someone',
        createdAt: new Date(i.createdAt).getTime(),
      }
    })
  )
}
