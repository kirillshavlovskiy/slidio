import { prisma } from '@/lib/prisma'
import { createGraphNode } from './nodes'
import { createGraphEdge } from './edges'

const KNOWLEDGE_TYPES = ['Topic', 'Claim', 'Metric'] as const

function parseProps(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Get or create the central hub Topic for a source document. */
export async function getOrCreateHubTopic(input: {
  branchId: string
  sourceDocumentId: string
  sourceTitle: string
}): Promise<string> {
  const existing = await prisma.graphNode.findMany({
    where: {
      branchId: input.branchId,
      sourceDocumentId: input.sourceDocumentId,
      type: 'Topic',
    },
    select: { id: true, properties: true, name: true },
  })

  for (const n of existing) {
    const props = parseProps(n.properties)
    if (props.isHub === true) return n.id
  }

  const byTitle = existing.find(n => n.name === input.sourceTitle)
  if (byTitle) {
    await prisma.graphNode.update({
      where: { id: byTitle.id },
      data: {
        properties: JSON.stringify({ ...parseProps(byTitle.properties), isHub: true }),
      },
    })
    return byTitle.id
  }

  const hub = await createGraphNode({
    branchId: input.branchId,
    type: 'Topic',
    name: input.sourceTitle,
    description: `Central hub for "${input.sourceTitle}"`,
    status: 'approved',
    confidence: 1,
    sourceDocumentId: input.sourceDocumentId,
    properties: { isHub: true },
  })
  return hub.id
}

export async function linkTopicToChunk(input: {
  branchId: string
  topicId: string
  chunkNodeId: string
  confidence?: number
  evidenceText?: string | null
}) {
  await createGraphEdge({
    branchId: input.branchId,
    fromNodeId: input.topicId,
    toNodeId: input.chunkNodeId,
    type: 'SUPPORTED_BY',
    confidence: input.confidence ?? 0.7,
    evidenceText: input.evidenceText ?? null,
  })
}

export async function linkSubtopicToHub(input: {
  branchId: string
  topicId: string
  hubTopicId: string
  confidence?: number
}) {
  if (input.topicId === input.hubTopicId) return
  await createGraphEdge({
    branchId: input.branchId,
    fromNodeId: input.topicId,
    toNodeId: input.hubTopicId,
    type: 'ABOUT',
    confidence: input.confidence ?? 0.8,
  })
}

export async function linkKnowledgeToTopic(input: {
  branchId: string
  nodeId: string
  topicId: string
  confidence?: number
}) {
  await createGraphEdge({
    branchId: input.branchId,
    fromNodeId: input.nodeId,
    toNodeId: input.topicId,
    type: 'ABOUT',
    confidence: input.confidence ?? 0.7,
  })
}

async function firstChunkNodeId(sourceDocumentId: string): Promise<string | null> {
  const chunk = await prisma.graphNode.findFirst({
    where: { sourceDocumentId, type: 'DocumentChunk' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  return chunk?.id ?? null
}

/** Ensure every knowledge node has at least one edge to another node in the graph. */
export async function ensureSourceGraphConnectivity(sourceDocumentId: string): Promise<number> {
  const source = await prisma.sourceDocument.findUnique({ where: { id: sourceDocumentId } })
  if (!source) return 0

  const hubTopicId = await getOrCreateHubTopic({
    branchId: source.branchId,
    sourceDocumentId: source.id,
    sourceTitle: source.title,
  })

  const firstChunkId = await firstChunkNodeId(sourceDocumentId)

  const nodes = await prisma.graphNode.findMany({
    where: {
      sourceDocumentId,
      type: { in: [...KNOWLEDGE_TYPES] },
    },
    select: { id: true, type: true, name: true, properties: true },
  })

  const edges = await prisma.graphEdge.findMany({
    where: {
      branchId: source.branchId,
      OR: [{ fromNodeId: { in: nodes.map(n => n.id) } }, { toNodeId: { in: nodes.map(n => n.id) } }],
    },
    select: { fromNodeId: true, toNodeId: true },
  })

  const connected = new Set<string>()
  for (const e of edges) {
    connected.add(e.fromNodeId)
    connected.add(e.toNodeId)
  }

  let added = 0

  for (const node of nodes) {
    if (connected.has(node.id)) continue

    if (node.type === 'Topic') {
      const props = parseProps(node.properties)
      if (props.isHub === true) {
        if (firstChunkId) {
          await linkTopicToChunk({
            branchId: source.branchId,
            topicId: node.id,
            chunkNodeId: firstChunkId,
            confidence: 1,
            evidenceText: 'Document hub',
          })
          added++
        }
        continue
      }

      await linkSubtopicToHub({
        branchId: source.branchId,
        topicId: node.id,
        hubTopicId,
      })
      if (firstChunkId) {
        await linkTopicToChunk({
          branchId: source.branchId,
          topicId: node.id,
          chunkNodeId: firstChunkId,
          confidence: 0.6,
        })
      }
      added += 2
      continue
    }

    // Orphan claim/metric → link to hub topic
    await linkKnowledgeToTopic({
      branchId: source.branchId,
      nodeId: node.id,
      topicId: hubTopicId,
    })
    if (firstChunkId) {
      await createGraphEdge({
        branchId: source.branchId,
        fromNodeId: node.id,
        toNodeId: firstChunkId,
        type: 'SUPPORTED_BY',
        confidence: 0.5,
        evidenceText: 'Auto-linked during graph connectivity pass',
      })
      added += 2
    } else {
      added++
    }
  }

  // Hub itself should touch the document structure when chunks exist
  if (firstChunkId && !connected.has(hubTopicId)) {
    await linkTopicToChunk({
      branchId: source.branchId,
      topicId: hubTopicId,
      chunkNodeId: firstChunkId,
      confidence: 1,
      evidenceText: 'Document hub',
    })
    added++
  }

  return added
}
