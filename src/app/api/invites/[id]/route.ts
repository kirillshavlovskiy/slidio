import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { acceptHubInvite, declineHubInvite } from '@/lib/hubAccess'

type Ctx = { params: { id: string } }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const email = session.user.email?.trim().toLowerCase()
  if (!email) return NextResponse.json({ error: 'Account has no email' }, { status: 400 })

  const { action } = await req.json().catch(() => ({}))
  if (action !== 'accept' && action !== 'decline') {
    return NextResponse.json({ error: 'action must be accept or decline' }, { status: 400 })
  }

  const result =
    action === 'accept'
      ? await acceptHubInvite(session.user.id, email, params.id)
      : await declineHubInvite(email, params.id)

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ ok: true, hubId: result.hubId })
}
