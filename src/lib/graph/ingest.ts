import { prisma } from '@/lib/prisma'
import { putExtractedText, readStoredBlob, readStoredText, isInlineTextUrl } from '@/lib/blobStorage'
import { parseBufferToText, fileTypeFromName } from '@/lib/parseDocumentServer'
import { segmentDocumentText } from './segment'
import { extractFromChunkBatch, BATCH_SIZE } from './extract'
import { filterExtractions } from './validate'
import { createGraphNode, deleteGraphForSource } from './nodes'
import { createGraphEdge } from './edges'
import { snapshotGraphVersion } from './version'
import {
  ensureSourceGraphConnectivity,
  getOrCreateHubTopic,
  linkKnowledgeToTopic,
  linkSubtopicToHub,
  linkTopicToChunk,
} from './connectivity'

export type IngestPrepareResult = {
  chunkCount: number
  totalBatches: number
  batchSize: number
  structureNodeCount: number
}

export type IngestBatchResult = {
  batchIndex: number
  totalBatches: number
  done: boolean
  itemsAdded: number
  knowledgeNodeCount: number
}

export async function parseSourceDocument(sourceId: string): Promise<void> {
  const source = await prisma.sourceDocument.findUnique({ where: { id: sourceId } })
  if (!source) throw new Error('Source not found')
  if (!source.blobUrl?.trim()) {
    throw new Error('Source file is missing — remove this source and upload again')
  }

  try {
    const buffer = await readStoredBlob(source.blobUrl)
    const text = await parseBufferToText(buffer, `${source.title}.${source.fileType}`)
    const extractedUrl = await putExtractedText(source.branchId, source.id, text)

    await prisma.sourceDocument.update({
      where: { id: sourceId },
      data: {
        extractedTextBlobUrl: extractedUrl,
        extractedText: isInlineTextUrl(extractedUrl) ? text : null,
        status: 'parsed',
        error: null,
        updatedAt: new Date(),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Parse failed'
    await prisma.sourceDocument.update({
      where: { id: sourceId },
      data: { status: 'failed', error: message, updatedAt: new Date() },
    })
    throw err
  }
}

async function loadExtractedText(source: {
  id: string
  extractedTextBlobUrl: string | null
  extractedText?: string | null
}): Promise<string> {
  if (source.extractedText?.trim()) return source.extractedText
  if (!source.extractedTextBlobUrl) throw new Error('Source has no extracted text')
  if (isInlineTextUrl(source.extractedTextBlobUrl)) {
    throw new Error('Extracted text missing from database — re-upload this document')
  }
  return readStoredText(source.extractedTextBlobUrl)
}

async function ensureParsed(sourceId: string) {
  const source = await prisma.sourceDocument.findUnique({ where: { id: sourceId } })
  if (!source) throw new Error('Source not found')
  if (!source.extractedTextBlobUrl) {
    await parseSourceDocument(sourceId)
  }
  const fresh = await prisma.sourceDocument.findUnique({ where: { id: sourceId } })
  if (!fresh?.extractedTextBlobUrl) throw new Error('Could not parse source')
  return fresh
}

async function chunkNodeIdFor(sourceDocumentId: string, chunkId: string): Promise<string> {
  const nodes = await prisma.graphNode.findMany({
    where: { sourceDocumentId, type: 'DocumentChunk' },
    select: { id: true, properties: true },
  })
  for (const n of nodes) {
    try {
      const props = JSON.parse(n.properties || '{}') as { chunkId?: string }
      if (props.chunkId === chunkId) return n.id
    } catch {
      /* skip */
    }
  }
  throw new Error(`Missing graph node for chunk ${chunkId}`)
}

async function topicNameMap(branchId: string, sourceDocumentId: string): Promise<Map<string, string>> {
  const topics = await prisma.graphNode.findMany({
    where: { branchId, sourceDocumentId, type: 'Topic' },
    select: { id: true, name: true },
  })
  return new Map(topics.map(t => [t.name.toLowerCase(), t.id]))
}

async function knowledgeNodeCount(sourceDocumentId: string): Promise<number> {
  return prisma.graphNode.count({
    where: {
      sourceDocumentId,
      type: { in: ['Topic', 'Claim', 'Metric'] },
    },
  })
}

/** Segment document and create source + chunk structure nodes (no LLM yet). */
export async function prepareSourceIngest(sourceId: string): Promise<IngestPrepareResult> {
  const fresh = await ensureParsed(sourceId)
  const text = await loadExtractedText(fresh)
  const segments = segmentDocumentText(text, fresh.fileType)

  await deleteGraphForSource(sourceId)

  const sourceNode = await createGraphNode({
    branchId: fresh.branchId,
    type: 'SourceDocument',
    name: fresh.title,
    status: 'candidate',
    confidence: 1,
    sourceDocumentId: fresh.id,
    createdBy: 'user',
    properties: { fileType: fresh.fileType, blobUrl: fresh.blobUrl },
  })

  await getOrCreateHubTopic({
    branchId: fresh.branchId,
    sourceDocumentId: fresh.id,
    sourceTitle: fresh.title,
  })

  let structureNodeCount = 1
  for (let ordinal = 0; ordinal < segments.length; ordinal++) {
    const seg = segments[ordinal]
    const chunk = await prisma.documentChunk.create({
      data: {
        sourceDocumentId: fresh.id,
        sectionTitle: seg.sectionTitle ?? null,
        text: seg.text,
        page: seg.page ?? null,
        charStart: seg.charStart ?? null,
        charEnd: seg.charEnd ?? null,
        ordinal,
      },
    })

    const chunkNode = await createGraphNode({
      branchId: fresh.branchId,
      type: 'DocumentChunk',
      name: chunk.sectionTitle || `Chunk ${chunk.ordinal + 1}`,
      description: chunk.text.slice(0, 200),
      status: 'candidate',
      confidence: 1,
      sourceDocumentId: fresh.id,
      properties: { chunkId: chunk.id, ordinal: chunk.ordinal },
    })
    structureNodeCount++

    await createGraphEdge({
      branchId: fresh.branchId,
      fromNodeId: chunkNode.id,
      toNodeId: sourceNode.id,
      type: 'PART_OF',
      confidence: 1,
    })
  }

  const totalBatches = Math.max(1, Math.ceil(segments.length / BATCH_SIZE))

  await prisma.sourceDocument.update({
    where: { id: sourceId },
    data: {
      status: 'extracting',
      error: `0/${totalBatches} batches`,
      updatedAt: new Date(),
    },
  })

  return {
    chunkCount: segments.length,
    totalBatches,
    batchSize: BATCH_SIZE,
    structureNodeCount,
  }
}

/** Run one LLM extraction batch; call repeatedly until `done` is true. */
export async function extractSourceBatch(
  sourceId: string,
  batchIndex: number,
  hubHints?: string
): Promise<IngestBatchResult> {
  const source = await prisma.sourceDocument.findUnique({ where: { id: sourceId } })
  if (!source) throw new Error('Source not found')

  const chunks = await prisma.documentChunk.findMany({
    where: { sourceDocumentId: sourceId },
    orderBy: { ordinal: 'asc' },
  })

  const totalBatches = Math.max(1, Math.ceil(chunks.length / BATCH_SIZE))
  if (batchIndex < 0 || batchIndex >= totalBatches) {
    throw new Error(`Invalid batch ${batchIndex + 1}/${totalBatches}`)
  }

  const batchStart = batchIndex * BATCH_SIZE
  const batchChunks = chunks.slice(batchStart, batchStart + BATCH_SIZE)
  const topicNameToId = await topicNameMap(source.branchId, source.id)
  const hubTopicId = await getOrCreateHubTopic({
    branchId: source.branchId,
    sourceDocumentId: source.id,
    sourceTitle: source.title,
  })
  const branchId = source.branchId
  const sourceDocId = source.id
  const sourceTitle = source.title

  let batchResults: Awaited<ReturnType<typeof extractFromChunkBatch>>
  try {
    batchResults = await extractFromChunkBatch(
      batchChunks.map(c => c.text),
      hubHints
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Extraction failed'
    await prisma.sourceDocument.update({
      where: { id: sourceId },
      data: { status: 'failed', error: msg, updatedAt: new Date() },
    })
    throw err
  }

  let itemsAdded = 0

  async function ensureTopicId(name: string, confidence: number, chunkNodeId: string): Promise<string> {
    const key = name.toLowerCase()
    let topicId = topicNameToId.get(key)
    if (!topicId) {
      const topicNode = await createGraphNode({
        branchId,
        type: 'Topic',
        name,
        status: 'candidate',
        confidence,
        sourceDocumentId: sourceDocId,
      })
      topicId = topicNode.id
      topicNameToId.set(key, topicId)
      itemsAdded++
      await linkTopicToChunk({
        branchId,
        topicId,
        chunkNodeId,
        confidence,
      })
      await linkSubtopicToHub({
        branchId,
        topicId,
        hubTopicId,
        confidence,
      })
    }
    return topicId
  }

  for (let j = 0; j < batchChunks.length; j++) {
    const chunk = batchChunks[j]
    const chunkNodeId = await chunkNodeIdFor(sourceDocId, chunk.id)
    const items = filterExtractions(batchResults[j] ?? [], chunk.text)
    const sectionTopic = chunk.sectionTitle?.trim() || sourceTitle

    for (const item of items) {
      if (item.type === 'Topic') {
        const key = item.name.toLowerCase()
        let topicId = topicNameToId.get(key)
        if (!topicId) {
          const topicNode = await createGraphNode({
            branchId,
            type: 'Topic',
            name: item.name,
            description: item.description ?? null,
            confidence: item.confidence,
            sourceDocumentId: sourceDocId,
          })
          topicId = topicNode.id
          topicNameToId.set(key, topicId)
          itemsAdded++
        }
        await linkTopicToChunk({
          branchId,
          topicId,
          chunkNodeId,
          confidence: item.confidence,
          evidenceText: item.evidenceText ?? item.description ?? null,
        })
        await linkSubtopicToHub({
          branchId,
          topicId,
          hubTopicId,
          confidence: item.confidence,
        })
        continue
      }

      const node = await createGraphNode({
        branchId,
        type: item.type,
        name: item.name,
        description: item.description ?? null,
        confidence: item.confidence,
        sourceDocumentId: sourceDocId,
        properties: item.evidenceText ? { evidenceText: item.evidenceText } : {},
      })
      itemsAdded++

      await createGraphEdge({
        branchId,
        fromNodeId: node.id,
        toNodeId: chunkNodeId,
        type: 'SUPPORTED_BY',
        confidence: item.confidence,
        evidenceText: item.evidenceText ?? item.description ?? null,
      })

      const topicLabel = (item.topicName?.trim() || sectionTopic).trim()
      if (topicLabel) {
        const topicId = await ensureTopicId(topicLabel, item.confidence, chunkNodeId)
        await linkKnowledgeToTopic({
          branchId,
          nodeId: node.id,
          topicId,
          confidence: item.confidence,
        })
      }
    }
  }

  const done = batchIndex >= totalBatches - 1
  const kCount = await knowledgeNodeCount(sourceDocId)

  if (done) {
    await ensureSourceGraphConnectivity(sourceDocId)
    await prisma.sourceDocument.update({
      where: { id: sourceId },
      data: { status: 'extracted', error: null, updatedAt: new Date() },
    })
    await snapshotGraphVersion({
      branchId,
      sourceDocumentId: sourceDocId,
      summary: `Ingested ${chunks.length} chunks from ${sourceTitle}`,
    })
  } else {
    await prisma.sourceDocument.update({
      where: { id: sourceId },
      data: {
        status: 'extracting',
        error: `${batchIndex + 1}/${totalBatches} batches · ${kCount} knowledge nodes`,
        updatedAt: new Date(),
      },
    })
  }

  return {
    batchIndex,
    totalBatches,
    done,
    itemsAdded,
    knowledgeNodeCount: kCount,
  }
}

/** Full ingest in one call (legacy); prefer prepare + batch from the client. */
export async function ingestSourceDocument(sourceId: string, hubHints?: string) {
  const prep = await prepareSourceIngest(sourceId)
  for (let i = 0; i < prep.totalBatches; i++) {
    await extractSourceBatch(sourceId, i, hubHints)
  }
  return {
    chunkCount: prep.chunkCount,
    topicCount: await knowledgeNodeCount(sourceId),
  }
}

export async function deleteSourceDocument(sourceId: string): Promise<void> {
  await deleteGraphForSource(sourceId)
  await prisma.sourceDocument.delete({ where: { id: sourceId } })
}

export { fileTypeFromName, parseBufferToText }
