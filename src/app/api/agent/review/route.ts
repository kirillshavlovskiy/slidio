import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { validateKnowledgeEdit } from '@/lib/agent/review'
import type { Change, SlideData } from '@/lib/types'
import type { SemanticEditPlan } from '@/lib/agent/types'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as {
    instruction?: string
    semanticEditPlan?: SemanticEditPlan | null
    changes?: Change[]
    slidesAfter?: SlideData[]
    approvalRequired?: boolean
  }

  const result = validateKnowledgeEdit({
    instruction: body.instruction?.trim() ?? '',
    semanticEditPlan: body.semanticEditPlan ?? null,
    changes: Array.isArray(body.changes) ? body.changes : [],
    slidesAfter: Array.isArray(body.slidesAfter) ? body.slidesAfter : [],
    approvalRequired: body.approvalRequired ?? false,
  })

  return NextResponse.json(result)
}
