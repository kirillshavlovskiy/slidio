import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { canAccessGraph } from '@/lib/hubAccess'
import { listGraphNodes } from '@/lib/graph/nodes'

function isGraphSchemaError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err)
  return /no such table: GraphNode/i.test(msg)
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const branchId = req.nextUrl.searchParams.get('branchId')
  if (!branchId) return NextResponse.json({ error: 'branchId required' }, { status: 400 })

  const access = await canAccessGraph(session.user.id, branchId, 'viewer')
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const type = req.nextUrl.searchParams.get('type') || undefined
  const status = req.nextUrl.searchParams.get('status') || undefined
  const sourceDocumentId = req.nextUrl.searchParams.get('sourceDocumentId') || undefined
  const presentationId = req.nextUrl.searchParams.get('presentationId') || undefined

  try {
    const nodes = await listGraphNodes({ branchId, type, status, sourceDocumentId, presentationId })
    return NextResponse.json(
      nodes.map(n => ({
        ...n,
        properties: JSON.parse(n.properties || '{}'),
        createdAt: new Date(n.createdAt).getTime(),
        updatedAt: new Date(n.updatedAt).getTime(),
      }))
    )
  } catch (err) {
    if (isGraphSchemaError(err)) return NextResponse.json([])
    throw err
  }
}
