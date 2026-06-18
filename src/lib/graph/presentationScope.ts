import { prisma } from '@/lib/prisma'
import { DECK_NODE_TYPES } from './schema'

/** Prisma client or DB missing newer GraphNode scalar columns. */
export function isGraphNodeFieldError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err)
  return (
    /Unknown argument `(presentationId|sourceDocumentId)`/i.test(msg) ||
    /no such column:.*(presentationId|sourceDocumentId)/i.test(msg)
  )
}

export const isPresentationIdSchemaError = isGraphNodeFieldError

function presentationIdFromProperties(properties: string | null): string | null {
  try {
    const p = JSON.parse(properties || '{}') as { presentationId?: string }
    return p.presentationId ?? null
  } catch {
    return null
  }
}

/** Find deck graph nodes for a presentation (works with or without presentationId column). */
export async function graphNodesForPresentation(
  presentationId: string,
  branchId?: string
) {
  try {
    return await prisma.graphNode.findMany({
      where: {
        presentationId,
        ...(branchId ? { branchId } : {}),
      },
    })
  } catch (err) {
    if (!isGraphNodeFieldError(err)) throw err
    const nodes = await prisma.graphNode.findMany({
      where: {
        ...(branchId ? { branchId } : {}),
        type: { in: [...DECK_NODE_TYPES] },
      },
    })
    return nodes.filter(n => presentationIdFromProperties(n.properties) === presentationId)
  }
}

export async function graphNodeIdsForPresentation(
  presentationId: string,
  branchId?: string
): Promise<string[]> {
  const nodes = await graphNodesForPresentation(presentationId, branchId)
  return nodes.map(n => n.id)
}

export async function createGraphNodeSafe(data: {
  branchId: string
  type: string
  name: string
  description?: string | null
  status?: string
  confidence?: number
  properties: string
  createdBy?: string
  sourceDocumentId?: string | null
  presentationId?: string | null
}) {
  const props = JSON.parse(data.properties || '{}') as Record<string, unknown>
  if (data.presentationId) props.presentationId = data.presentationId
  if (data.sourceDocumentId) props.sourceDocumentId = data.sourceDocumentId

  const minimal = {
    branchId: data.branchId,
    type: data.type,
    name: data.name,
    description: data.description ?? null,
    status: data.status ?? 'candidate',
    confidence: data.confidence ?? 0.5,
    properties: JSON.stringify(props),
    createdBy: data.createdBy ?? 'ai_agent',
  }

  const full = {
    ...minimal,
    sourceDocumentId: data.sourceDocumentId ?? null,
    presentationId: data.presentationId ?? null,
  }

  try {
    return await prisma.graphNode.create({ data: full })
  } catch (err) {
    if (!isGraphNodeFieldError(err)) throw err
    return prisma.graphNode.create({ data: minimal })
  }
}

export async function updateGraphNodeSafe(
  id: string,
  data: {
    name?: string
    description?: string | null
    properties: string
    presentationId?: string | null
  }
) {
  try {
    return await prisma.graphNode.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        properties: data.properties,
        presentationId: data.presentationId ?? undefined,
        updatedAt: new Date(),
      },
    })
  } catch (err) {
    if (!isGraphNodeFieldError(err)) throw err
    return prisma.graphNode.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        properties: data.properties,
        updatedAt: new Date(),
      },
    })
  }
}

export async function createGraphVersionSafe(data: {
  branchId: string
  sourceDocumentId?: string | null
  presentationId?: string | null
  summary: string
  nodeCount: number
  edgeCount: number
}) {
  try {
    return await prisma.graphVersion.create({ data })
  } catch (err) {
    if (!isGraphNodeFieldError(err)) throw err
    const { presentationId: _p, sourceDocumentId: _s, ...rest } = data
    return prisma.graphVersion.create({ data: rest })
  }
}
