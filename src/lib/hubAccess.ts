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

/** True when collaboration tables/columns aren't on the DB yet (pre-migration deploy). */
function isCollaborationSchemaError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err)
  return /no such table: HubMember|no such table: HubInvite|no such column: isSuperuser|no such column: actorId/i.test(
    msg
  )
}

export async function isSuperuser(userId: string): Promise<boolean> {
  try {
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
  } catch (err) {
    if (isCollaborationSchemaError(err)) return false
    throw err
  }
}

async function ensureOwnerMembership(hubId: string, ownerUserId: string): Promise<void> {
  try {
    await prisma.hubMember.upsert({
      where: { hubId_userId: { hubId, userId: ownerUserId } },
      update: {},
      create: { hubId, userId: ownerUserId, role: 'owner' },
    })
  } catch (err) {
    if (!isCollaborationSchemaError(err)) throw err
  }
}

export async function getHubRole(userId: string, hubId: string): Promise<HubRole | null> {
  const hub = await prisma.knowledgeBranch.findUnique({ where: { id: hubId } })
  if (!hub) return null

  if (await isSuperuser(userId)) return 'owner'

  if (hub.userId === userId) {
    await ensureOwnerMembership(hubId, hub.userId)
    return 'owner'
  }

  try {
    const member = await prisma.hubMember.findUnique({
      where: { hubId_userId: { hubId, userId } },
    })
    return (member?.role as HubRole) ?? null
  } catch (err) {
    if (isCollaborationSchemaError(err)) return null
    throw err
  }
}

export async function acceptHubInvite(
  userId: string,
  email: string,
  inviteId: string
): Promise<{ ok: true; hubId: string } | { ok: false; error: string; status: number }> {
  const invite = await prisma.hubInvite.findUnique({ where: { id: inviteId } })
  if (!invite || invite.status !== 'pending') {
    return { ok: false, error: 'Invite not found', status: 404 }
  }
  if (invite.email !== email.toLowerCase()) {
    return { ok: false, error: 'Invite not found', status: 404 }
  }

  await prisma.hubMember.upsert({
    where: { hubId_userId: { hubId: invite.hubId, userId } },
    update: { role: invite.role },
    create: { hubId: invite.hubId, userId, role: invite.role },
  })
  await prisma.hubInvite.update({ where: { id: inviteId }, data: { status: 'accepted' } })
  return { ok: true, hubId: invite.hubId }
}

export async function declineHubInvite(
  email: string,
  inviteId: string
): Promise<{ ok: true; hubId: string } | { ok: false; error: string; status: number }> {
  const invite = await prisma.hubInvite.findUnique({ where: { id: inviteId } })
  if (!invite || invite.status !== 'pending') {
    return { ok: false, error: 'Invite not found', status: 404 }
  }
  if (invite.email !== email.toLowerCase()) {
    return { ok: false, error: 'Invite not found', status: 404 }
  }

  await prisma.hubInvite.update({ where: { id: inviteId }, data: { status: 'declined' } })
  return { ok: true, hubId: invite.hubId }
}

/** Hub ids the user owns or is a member of. Always includes owned hubs even pre-migration. */
export async function accessibleHubIds(userId: string): Promise<string[]> {
  const owned = await prisma.knowledgeBranch.findMany({
    where: { userId },
    select: { id: true },
  })
  const ids = new Set(owned.map(b => b.id))

  try {
    if (await isSuperuser(userId)) {
      const all = await prisma.knowledgeBranch.findMany({ select: { id: true } })
      return all.map(b => b.id)
    }
    const memberships = await prisma.hubMember.findMany({
      where: { userId },
      select: { hubId: true },
    })
    for (const m of memberships) ids.add(m.hubId)
  } catch (err) {
    if (!isCollaborationSchemaError(err)) throw err
  }

  return Array.from(ids)
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

/** Hub-scoped graph access — viewer can read; editor+ can write. */
export async function canAccessGraph(
  userId: string,
  branchId: string,
  minRole: HubRole = 'viewer'
): Promise<{ ok: boolean; role: HubRole | null; readOnly: boolean }> {
  const role = await getHubRole(userId, branchId)
  if (!role) return { ok: false, role: null, readOnly: true }
  const ok = roleAtLeast(role, minRole)
  return { ok, role, readOnly: role === 'viewer' }
}
