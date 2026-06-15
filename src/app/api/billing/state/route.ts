import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getBillingState } from '@/lib/billing/subscription'

export const runtime = 'nodejs'

// Lightweight, client-fetchable view of the signed-in user's plan so the UI can
// show the current tariff and the right upgrade/manage action.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const state = await getBillingState(session.user.id)
  return NextResponse.json(state)
}
