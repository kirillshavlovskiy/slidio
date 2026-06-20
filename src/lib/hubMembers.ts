import { prisma } from './prisma'
import type { HubMemberSummary, HubRole } from './types'

/** Owner + accepted hub members for avatar stacks and collaboration UI. */
export async function fetchHubMemberSummaries(
  hubId: string,
  ownerUserId: string
): Promise<HubMemberSummary[]> {
  try {
    const [owner, members] = await Promise.all([
      prisma.user.findUnique({
        where: { id: ownerUserId },
        select: { id: true, name: true, email: true, image: true },
      }),
      prisma.hubMember.findMany({
        where: { hubId },
        include: { user: { select: { id: true, name: true, email: true, image: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    const byUserId = new Map<string, HubMemberSummary>()
    if (owner) {
      byUserId.set(owner.id, {
        userId: owner.id,
        name: owner.name,
        email: owner.email,
        image: owner.image,
        role: 'owner',
      })
    }
    for (const m of members) {
      const existing = byUserId.get(m.userId)
      byUserId.set(m.userId, {
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        image: m.user.image,
        role: (existing?.role === 'owner' ? 'owner' : m.role) as HubRole,
      })
    }
    return Array.from(byUserId.values())
  } catch {
    return []
  }
}
