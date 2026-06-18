import { prisma } from '@/lib/prisma'
import type { GraphEdgeType } from './schema'
import { graphNodeIdsForPresentation } from './presentationScope'

export type CreateEdgeInput = {
  branchId: string
  fromNodeId: string
  toNodeId: string
  type: GraphEdgeType
  confidence?: number
  evidenceText?: string | null
  properties?: Record<string, unknown>
}

export async function createGraphEdge(input: CreateEdgeInput) {
  const existing = await prisma.graphEdge.findFirst({
    where: {
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      type: input.type,
    },
  })
  if (existing) return existing

  return prisma.graphEdge.create({
    data: {
      branchId: input.branchId,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      type: input.type,
      confidence: input.confidence ?? 0.5,
      evidenceText: input.evidenceText ?? null,
      properties: JSON.stringify(input.properties ?? {}),
    },
  })
}

export async function listGraphEdges(filters: {
  branchId: string
  fromNodeId?: string
  toNodeId?: string
  type?: string
  sourceDocumentId?: string
  presentationId?: string
}) {
  if (filters.presentationId) {
    const nodeIds = await graphNodeIdsForPresentation(filters.presentationId, filters.branchId)
    if (!nodeIds.length) return []
    return prisma.graphEdge.findMany({
      where: {
        branchId: filters.branchId,
        OR: [{ fromNodeId: { in: nodeIds } }, { toNodeId: { in: nodeIds } }],
        ...(filters.type ? { type: filters.type } : {}),
      },
      orderBy: { createdAt: 'asc' },
    })
  }

  if (filters.sourceDocumentId) {
    const nodeIds = (
      await prisma.graphNode.findMany({
        where: { branchId: filters.branchId, sourceDocumentId: filters.sourceDocumentId },
        select: { id: true },
      })
    ).map(n => n.id)
    if (!nodeIds.length) return []
    return prisma.graphEdge.findMany({
      where: {
        branchId: filters.branchId,
        OR: [{ fromNodeId: { in: nodeIds } }, { toNodeId: { in: nodeIds } }],
        ...(filters.type ? { type: filters.type } : {}),
      },
      orderBy: { createdAt: 'asc' },
    })
  }

  return prisma.graphEdge.findMany({
    where: {
      branchId: filters.branchId,
      ...(filters.fromNodeId ? { fromNodeId: filters.fromNodeId } : {}),
      ...(filters.toNodeId ? { toNodeId: filters.toNodeId } : {}),
      ...(filters.type ? { type: filters.type } : {}),
    },
    orderBy: { createdAt: 'asc' },
  })
}
