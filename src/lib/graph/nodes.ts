import { prisma } from '@/lib/prisma'
import type { GraphNodeType, NodeStatus, DeckNodeType } from './schema'
import { deckRefKey } from './schema'
import {
  createGraphNodeSafe,
  graphNodesForPresentation,
  graphNodeIdsForPresentation,
  updateGraphNodeSafe,
} from './presentationScope'

export type CreateNodeInput = {
  branchId: string
  type: GraphNodeType
  name: string
  description?: string | null
  status?: NodeStatus
  confidence?: number
  properties?: Record<string, unknown>
  createdBy?: 'ai_agent' | 'user'
  sourceDocumentId?: string | null
  presentationId?: string | null
}

export async function createGraphNode(input: CreateNodeInput) {
  const properties = { ...(input.properties ?? {}) }
  if (input.presentationId) properties.presentationId = input.presentationId

  return createGraphNodeSafe({
    branchId: input.branchId,
    type: input.type,
    name: input.name,
    description: input.description ?? null,
    status: input.status ?? 'candidate',
    confidence: input.confidence ?? 0.5,
    properties: JSON.stringify(properties),
    createdBy: input.createdBy ?? 'ai_agent',
    sourceDocumentId: input.sourceDocumentId ?? null,
    presentationId: input.presentationId ?? null,
  })
}

export async function upsertCandidateNode(input: CreateNodeInput) {
  const existing = await prisma.graphNode.findFirst({
    where: {
      branchId: input.branchId,
      type: input.type,
      name: input.name,
      sourceDocumentId: input.sourceDocumentId ?? null,
      status: 'candidate',
    },
  })
  if (existing) {
    return prisma.graphNode.update({
      where: { id: existing.id },
      data: {
        description: input.description ?? existing.description,
        confidence: input.confidence ?? existing.confidence,
        properties: JSON.stringify(input.properties ?? JSON.parse(existing.properties || '{}')),
        updatedAt: new Date(),
      },
    })
  }
  return createGraphNode(input)
}

/** Upsert a deck-scoped node by stable refKey in properties. */
export async function upsertDeckNode(input: CreateNodeInput & {
  refKey: string
  deckType: DeckNodeType
  slideId?: string
  elementId?: string
}) {
  const candidates = input.presentationId
    ? await graphNodesForPresentation(input.presentationId, input.branchId)
    : await prisma.graphNode.findMany({
        where: { branchId: input.branchId, type: input.deckType },
      })

  const typed = candidates.filter(n => n.type === input.deckType)

  const existing = typed.find(n => {
    try {
      const props = JSON.parse(n.properties || '{}') as { refKey?: string }
      return props.refKey === input.refKey
    } catch {
      return false
    }
  })

  const properties = {
    ...(input.properties ?? {}),
    refKey: input.refKey,
    presentationId: input.presentationId,
    ...(input.slideId ? { slideId: input.slideId } : {}),
    ...(input.elementId ? { elementId: input.elementId } : {}),
  }

  if (existing) {
    return updateGraphNodeSafe(existing.id, {
      name: input.name,
      description: input.description ?? existing.description,
      properties: JSON.stringify(properties),
      presentationId: input.presentationId ?? null,
    })
  }

  return createGraphNode({
    ...input,
    properties,
  })
}

export async function listGraphNodes(filters: {
  branchId: string
  type?: string
  status?: string
  sourceDocumentId?: string
  presentationId?: string
}) {
  if (filters.presentationId) {
    const nodes = await graphNodesForPresentation(filters.presentationId, filters.branchId)
    return nodes.filter(n => {
      if (filters.type && n.type !== filters.type) return false
      if (filters.status && n.status !== filters.status) return false
      if (filters.sourceDocumentId && n.sourceDocumentId !== filters.sourceDocumentId) return false
      return true
    })
  }

  return prisma.graphNode.findMany({
    where: {
      branchId: filters.branchId,
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.sourceDocumentId ? { sourceDocumentId: filters.sourceDocumentId } : {}),
    },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  })
}

export async function findDeckNodeByRef(
  branchId: string,
  presentationId: string,
  refKey: string
) {
  const nodes = await graphNodesForPresentation(presentationId, branchId)
  return nodes.find(n => {
    try {
      return (JSON.parse(n.properties || '{}') as { refKey?: string }).refKey === refKey
    } catch {
      return false
    }
  }) ?? null
}

export async function deleteGraphForSource(sourceDocumentId: string) {
  const nodeIds = (
    await prisma.graphNode.findMany({
      where: { sourceDocumentId },
      select: { id: true },
    })
  ).map(n => n.id)

  if (nodeIds.length) {
    await prisma.graphEdge.deleteMany({
      where: {
        OR: [{ fromNodeId: { in: nodeIds } }, { toNodeId: { in: nodeIds } }],
      },
    })
    await prisma.graphNode.deleteMany({ where: { id: { in: nodeIds } } })
  }

  await prisma.documentChunk.deleteMany({ where: { sourceDocumentId } })
}

/** Remove all deck graph nodes (and their edges) for a presentation. KB nodes untouched. */
export async function deleteDeckGraph(presentationId: string, branchId?: string) {
  const nodeIds = await graphNodeIdsForPresentation(presentationId, branchId)
  if (!nodeIds.length) return

  await prisma.graphEdge.deleteMany({
    where: {
      OR: [{ fromNodeId: { in: nodeIds } }, { toNodeId: { in: nodeIds } }],
    },
  })
  await prisma.graphNode.deleteMany({ where: { id: { in: nodeIds } } })
}

export { deckRefKey }
