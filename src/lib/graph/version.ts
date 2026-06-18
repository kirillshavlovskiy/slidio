import { prisma } from '@/lib/prisma'
import { createGraphVersionSafe, graphNodeIdsForPresentation } from './presentationScope'

export async function snapshotGraphVersion(input: {
  branchId: string
  sourceDocumentId?: string | null
  presentationId?: string | null
  summary: string
}) {
  const nodeCount = input.presentationId
    ? (await graphNodeIdsForPresentation(input.presentationId, input.branchId)).length
    : input.sourceDocumentId
      ? await prisma.graphNode.count({
          where: { branchId: input.branchId, sourceDocumentId: input.sourceDocumentId },
        })
      : await prisma.graphNode.count({ where: { branchId: input.branchId } })

  let edgeCount = 0
  if (input.sourceDocumentId) {
    const nodeIds = (
      await prisma.graphNode.findMany({
        where: { branchId: input.branchId, sourceDocumentId: input.sourceDocumentId },
        select: { id: true },
      })
    ).map(n => n.id)
    if (nodeIds.length) {
      edgeCount = await prisma.graphEdge.count({
        where: {
          branchId: input.branchId,
          OR: [{ fromNodeId: { in: nodeIds } }, { toNodeId: { in: nodeIds } }],
        },
      })
    }
  } else if (input.presentationId) {
    const nodeIds = await graphNodeIdsForPresentation(input.presentationId, input.branchId)
    if (nodeIds.length) {
      edgeCount = await prisma.graphEdge.count({
        where: {
          branchId: input.branchId,
          OR: [{ fromNodeId: { in: nodeIds } }, { toNodeId: { in: nodeIds } }],
        },
      })
    }
  } else {
    edgeCount = await prisma.graphEdge.count({ where: { branchId: input.branchId } })
  }

  return createGraphVersionSafe({
    branchId: input.branchId,
    sourceDocumentId: input.sourceDocumentId ?? null,
    presentationId: input.presentationId ?? null,
    summary: input.summary,
    nodeCount,
    edgeCount,
  })
}
