import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { canAccessGraph } from '@/lib/hubAccess'
import { listGraphEdges } from '@/lib/graph/edges'

function isGraphSchemaError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err)
  return /no such table: GraphEdge/i.test(msg)
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const branchId = req.nextUrl.searchParams.get('branchId')
  if (!branchId) return NextResponse.json({ error: 'branchId required' }, { status: 400 })

  const access = await canAccessGraph(session.user.id, branchId, 'viewer')
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const fromNodeId = req.nextUrl.searchParams.get('fromNodeId') || undefined
  const toNodeId = req.nextUrl.searchParams.get('toNodeId') || undefined
  const type = req.nextUrl.searchParams.get('type') || undefined
  const sourceDocumentId = req.nextUrl.searchParams.get('sourceDocumentId') || undefined
  const presentationId = req.nextUrl.searchParams.get('presentationId') || undefined

  try {
    const edges = await listGraphEdges({ branchId, fromNodeId, toNodeId, type, sourceDocumentId, presentationId })
    return NextResponse.json(
      edges.map(e => ({
        ...e,
        properties: JSON.parse(e.properties || '{}'),
        createdAt: new Date(e.createdAt).getTime(),
      }))
    )
  } catch (err) {
    if (isGraphSchemaError(err)) return NextResponse.json([])
    throw err
  }
}
