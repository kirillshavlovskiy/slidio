import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getBillingState } from '@/lib/billing/subscription'
import { getUsageState } from '@/lib/billing/usage'

export const runtime = 'nodejs'

// Lightweight, client-fetchable view of the signed-in user's plan so the UI can
// show the current tariff, usage vs limit, and the right upgrade/manage action.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id
  const [state, usage] = await Promise.all([
    getBillingState(userId),
    getUsageState(userId),
  ])
  return NextResponse.json({
    ...state,
    usage: {
      tokensUsed: usage.tokensUsed,
      tokenLimit: usage.tokenLimit,
      tokensRemaining: usage.tokensRemaining,
      periodKey: usage.periodKey,
    },
  })
}
