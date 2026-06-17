import { prisma } from './prisma'

/**
 * Hub (KnowledgeBranch) collaboration roles, ordered by capability.
 *   owner  — manage members + settings, edit, delete
 *   editor — full read/write (AI edits, apply, versions, knowledge)
 *   viewer — read-only
 */
export type HubRole = 'owner' | 'editor' | 'viewer'

const RANK: Record<HubRole, number> = { viewer: 1, editor: 2, owner: 3 }

export function roleAtLeast(role: HubRole | null, min: HubRole): boolean {
  return !!role && RANK[role] >= RANK[min]
}

const SUPERUSER_EMAILS = new Set(
  (process.env.SUPERUSER_EMAILS || 'dev@local.test,kirillshavlovskiy@gmail.com')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
)

export async function isSuperuser(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuperuser: true, email: true },
  })
  if (!u) return false
  if (u.isSuperuser) return true
  if (u.email && SUPERUSER_EMAILS.has(u.email.toLowerCase())) {
    await prisma.user.update({ where: { id: userId }, data: { isSuperuser: true } }).catch(() => {})
    return true
  }
  return false
}

async function ensureOwnerMembership(hubId: string, ownerUserId: string): Promise<void> {
  await prisma.hubMember.upsert({
    where: { hubId_userId: { hubId, userId: ownerUserId } },
    update: {},
    create: { hubId, userId: ownerUserId, role: 'owner' },
  })
}

export async function getHubRole(userId: string, hubId: string): Promise<HubRole | null> {
  const hub = await prisma.knowledgeBranch.findUnique({ where: { id: hubId } })
  if (!hub) return null

  if (await isSuperuser(userId)) return 'owner'

  if (hub.userId === userId) {
    await ensureOwnerMembership(hubId, hub.userId)
    return 'owner'
  }

  const member = await prisma.hubMember.findUnique({
    where: { hubId_userId: { hubId, userId } },
  })
  return (member?.role as HubRole) ?? null
}

export async function acceptPendingInvites(
  userId: string,
  email: string | null | undefined
): Promise<void> {
  if (!email) return
  const invites = await prisma.hubInvite.findMany({
    where: { email: email.toLowerCase(), status: 'pending' },
  })
  for (const inv of invites) {
    await prisma.hubMember.upsert({
      where: { hubId_userId: { hubId: inv.hubId, userId } },
      update: {},
      create: { hubId: inv.hubId, userId, role: inv.role },
    })
    await prisma.hubInvite.update({ where: { id: inv.id }, data: { status: 'accepted' } })
  }
}

export async function accessibleHubIds(userId: string): Promise<string[]> {
  if (await isSuperuser(userId)) {
    const all = await prisma.knowledgeBranch.findMany({ select: { id: true } })
    return all.map(b => b.id)
  }
  const [owned, memberships] = await Promise.all([
    prisma.knowledgeBranch.findMany({ where: { userId }, select: { id: true } }),
    prisma.hubMember.findMany({ where: { userId }, select: { hubId: true } }),
  ])
  return Array.from(new Set([...owned.map(b => b.id), ...memberships.map(m => m.hubId)]))
}

export async function canAccessPresentation(
  userId: string,
  presentationId: string
): Promise<{ ok: boolean; role: HubRole | null; ownerId: string | null }> {
  const pres = await prisma.presentation.findUnique({
    where: { id: presentationId },
    select: { userId: true, branchId: true },
  })
  if (!pres) return { ok: false, role: null, ownerId: null }
  if (await isSuperuser(userId)) return { ok: true, role: 'owner', ownerId: pres.userId }
  if (pres.userId === userId) return { ok: true, role: 'owner', ownerId: pres.userId }
  if (pres.branchId) {
    const role = await getHubRole(userId, pres.branchId)
    if (role) return { ok: true, role, ownerId: pres.userId }
  }
  return { ok: false, role: null, ownerId: pres.userId }
}

/** Resolve hub role for a knowledge layer (branch-scoped or personal). */
export async function canAccessKnowledgeLayer(
  userId: string,
  layer: { userId: string; branchId: string | null }
): Promise<{ ok: boolean; role: HubRole | null; readOnly: boolean }> {
  if (!layer.branchId) {
    const ok = layer.userId === userId || (await isSuperuser(userId))
    return { ok, role: ok ? 'owner' : null, readOnly: false }
  }
  const role = await getHubRole(userId, layer.branchId)
  if (!role) return { ok: false, role: null, readOnly: true }
  return { ok: true, role, readOnly: role === 'viewer' }
}
