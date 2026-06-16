import { NextResponse } from 'next/server'
import { readPlanTokenLimits, type PlanId } from '@/lib/billing/plans'

export const runtime = 'nodejs'

/** Public plan token limits — env-configured on the server, safe to expose. */
export async function GET() {
  const limits = readPlanTokenLimits()
  return NextResponse.json({ limits } satisfies { limits: Record<PlanId, number> })
}
