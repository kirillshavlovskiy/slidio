import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessGraph, roleAtLeast } from '@/lib/hubAccess'
import { ensureSourceGraphConnectivity } from '@/lib/graph/connectivity'

export const runtime = 'nodejs'

/** Repair missing edges on extracted source documents in a hub. */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { branchId?: string; sourceId?: string }
  const branchId = body.branchId?.trim()
  if (!branchId) return NextResponse.json({ error: 'branchId required' }, { status: 400 })

  const access = await canAccessGraph(session.user.id, branchId, 'moderator')
  if (!access.ok || !roleAtLeast(access.role, 'moderator')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sources = body.sourceId
    ? await prisma.sourceDocument.findMany({
        where: { id: body.sourceId, branchId, status: 'extracted' },
        select: { id: true },
      })
    : await prisma.sourceDocument.findMany({
        where: { branchId, status: 'extracted' },
        select: { id: true },
      })

  let edgesAdded = 0
  for (const s of sources) {
    edgesAdded += await ensureSourceGraphConnectivity(s.id)
  }

  return NextResponse.json({ ok: true, sourcesRepaired: sources.length, edgesAdded })
}
