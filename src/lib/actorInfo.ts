/** Resolve a display label from user profile fields. */
export function actorDisplayName(name?: string | null, email?: string | null): string {
  const n = name?.trim()
  if (n) return n
  const e = email?.trim()
  if (e) return e.split('@')[0] || e
  return 'Someone'
}

/** Whether a version snapshot came from AI or a direct manual edit. */
export function versionChangeKind(v: {
  decisionId?: string | null
  changeLog?: string
}): 'ai' | 'manual' {
  if (v.decisionId) return 'ai'
  if (v.changeLog?.startsWith('Agent:')) return 'ai'
  return 'manual'
}

export type ActorSummary = {
  userId?: string | null
  name?: string | null
  email?: string | null
  image?: string | null
}

export function actorFromSummary(a?: ActorSummary | null) {
  if (!a?.userId && !a?.name && !a?.email) return null
  return {
    userId: a.userId ?? undefined,
    name: actorDisplayName(a.name, a.email),
    image: a.image ?? undefined,
  }
}
