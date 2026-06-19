import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { canAccessGraph } from '@/lib/hubAccess'
import { buildAgentPlan } from '@/lib/agent/knowledgePlanner'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as {
    branchId?: string
    presentationId?: string | null
    instruction?: string
    targetSlideIds?: string[]
  }

  const branchId = body.branchId?.trim()
  if (!branchId) return NextResponse.json({ error: 'branchId required' }, { status: 400 })

  const access = await canAccessGraph(session.user.id, branchId, 'viewer')
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const instruction = body.instruction?.trim() ?? ''
  const targetSlideIds = Array.isArray(body.targetSlideIds) ? body.targetSlideIds : []

  try {
    const plan = await buildAgentPlan({
      branchId,
      presentationId: body.presentationId ?? null,
      instruction,
      targetSlideIds,
    })
    return NextResponse.json(plan)
  } catch (err) {
    console.error('agent plan error:', err)
    return NextResponse.json({ error: 'Failed to build agent plan' }, { status: 500 })
  }
}
