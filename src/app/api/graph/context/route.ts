import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { canAccessGraph } from '@/lib/hubAccess'
import { buildGraphKnowledgeContext } from '@/lib/graph/retrieve'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const branchId = req.nextUrl.searchParams.get('branchId')
  if (!branchId) return NextResponse.json({ error: 'branchId required' }, { status: 400 })

  const access = await canAccessGraph(session.user.id, branchId, 'viewer')
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const presentationId = req.nextUrl.searchParams.get('presentationId') || undefined
  const instruction = req.nextUrl.searchParams.get('instruction') || undefined
  const charBudget = Number(req.nextUrl.searchParams.get('charBudget') || 8000)

  try {
    const result = await buildGraphKnowledgeContext({
      branchId,
      presentationId,
      instruction,
      charBudget: Number.isFinite(charBudget) ? charBudget : 8000,
    })
    return NextResponse.json(result)
  } catch (err) {
    console.error('graph context error:', err)
    return NextResponse.json({
      context: '',
      claimCount: 0,
      metricCount: 0,
      topicCount: 0,
      sourceCount: 0,
      mappingCount: 0,
    })
  }
}
