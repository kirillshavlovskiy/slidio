import { prisma } from '@/lib/prisma'
import type { SlideData } from '@/lib/types'
import { createGraphEdge } from './edges'
import { deleteDeckGraph, listGraphNodes } from './nodes'
import { graphNodesForPresentation } from './presentationScope'
import { projectDeckGraph, type ProjectDeckResult } from './project'
import { mapSlideToKnowledge, type ElementMapping, type SlideTopicMapping } from './mapDeck'
import { snapshotGraphVersion } from './version'
import { MIN_CONFIDENCE } from './schema'
import { validateEdgeCreation } from './validate'

export type MapPresentationResult = {
  presentationId: string
  branchId: string
  projected: ProjectDeckResult
  elementMappings: ElementMapping[]
  slideTopics: SlideTopicMapping[]
  mappingCount: number
}

async function loadKnowledgeCatalog(branchId: string) {
  const nodes = await listGraphNodes({
    branchId,
    type: undefined,
  })
  return nodes
    .filter(n => n.type === 'Topic' || n.type === 'Claim' || n.type === 'Metric')
    .map(n => ({
      id: n.id,
      type: n.type as 'Topic' | 'Claim' | 'Metric',
      name: n.name,
      description: n.description,
    }))
}

async function applyMappings(input: {
  branchId: string
  projected: ProjectDeckResult
  elementMappings: ElementMapping[]
  slideTopics: SlideTopicMapping[]
}) {
  const { branchId, projected, elementMappings, slideTopics } = input
  let count = 0

  const kbNodes = await prisma.graphNode.findMany({
    where: {
      id: {
        in: [
          ...elementMappings.map(m => m.knowledgeNodeId),
          ...slideTopics.map(t => t.topicNodeId),
        ],
      },
    },
    select: { id: true, type: true },
  })
  const kbType = new Map(kbNodes.map(n => [n.id, n.type]))

  for (const m of elementMappings) {
    const elemKey = `${m.slideId}:${m.elementId}`
    const fromId = projected.elementNodeIds.get(elemKey)
    const toType = kbType.get(m.knowledgeNodeId)
    if (!fromId || !toType) continue
    if (m.edgeType === 'EXPRESSES' && toType !== 'Claim') continue
    if (m.edgeType === 'REPRESENTS' && toType !== 'Metric') continue
    if (!validateEdgeCreation(m.edgeType, 'SlideElement', toType as 'Claim' | 'Metric')) continue
    if (m.confidence < MIN_CONFIDENCE) continue

    await createGraphEdge({
      branchId,
      fromNodeId: fromId,
      toNodeId: m.knowledgeNodeId,
      type: m.edgeType,
      confidence: m.confidence,
      evidenceText: m.evidenceText ?? null,
      properties: { slideId: m.slideId, elementId: m.elementId },
    })
    count++
  }

  for (const t of slideTopics) {
    const fromId = projected.slideNodeIds.get(t.slideId)
    const toType = kbType.get(t.topicNodeId)
    if (!fromId || toType !== 'Topic') continue
    if (!validateEdgeCreation('ABOUT', 'Slide', 'Topic')) continue
    if (t.confidence < MIN_CONFIDENCE) continue

    await createGraphEdge({
      branchId,
      fromNodeId: fromId,
      toNodeId: t.topicNodeId,
      type: 'ABOUT',
      confidence: t.confidence,
      properties: { slideId: t.slideId },
    })
    count++
  }

  return count
}

/** Full deck map: re-project structure + LLM map to KB nodes. */
export async function mapPresentationDeck(input: {
  branchId: string
  presentationId: string
  presentationName: string
  slides: SlideData[]
  skipLlm?: boolean
}): Promise<MapPresentationResult> {
  const { branchId, presentationId, presentationName, slides, skipLlm } = input

  await deleteDeckGraph(presentationId, branchId)

  const projected = await projectDeckGraph({
    branchId,
    presentationId,
    presentationName,
    slides,
  })

  const elementMappings: ElementMapping[] = []
  const slideTopics: SlideTopicMapping[] = []

  if (!skipLlm) {
    const knowledge = await loadKnowledgeCatalog(branchId)
    if (knowledge.length) {
      for (let i = 0; i < slides.length; i++) {
        const result = await mapSlideToKnowledge({
          slide: slides[i],
          slideIndex: i,
          presentationId,
          knowledge,
        })
        elementMappings.push(...result.elementMappings)
        slideTopics.push(...result.slideTopics)
        if (i < slides.length - 1) {
          await new Promise(r => setTimeout(r, 1500))
        }
      }
    }
  }

  const mappingCount = await applyMappings({
    branchId,
    projected,
    elementMappings,
    slideTopics,
  })

  await snapshotGraphVersion({
    branchId,
    presentationId,
    summary: `Mapped deck "${presentationName}" — ${projected.slideCount} slides, ${mappingCount} knowledge links`,
  })

  return {
    presentationId,
    branchId,
    projected,
    elementMappings,
    slideTopics,
    mappingCount,
  }
}

/** Lightweight sync: project deck structure only (no LLM). */
export async function syncDeckProjection(input: {
  branchId: string
  presentationId: string
  presentationName: string
  slides: SlideData[]
}) {
  return projectDeckGraph(input)
}

export async function getDeckMappingSummary(presentationId: string, branchId?: string) {
  const deckNodes = await graphNodesForPresentation(presentationId, branchId)
  if (!deckNodes.length) return null

  const deckIds = new Set(deckNodes.map(n => n.id))
  const edges = await prisma.graphEdge.findMany({
    where: {
      OR: [{ fromNodeId: { in: [...deckIds] } }, { toNodeId: { in: [...deckIds] } }],
      type: { in: ['EXPRESSES', 'REPRESENTS', 'ABOUT', 'HAS_SLIDE', 'CONTAINS_ELEMENT'] },
    },
  })

  const kbIds = new Set<string>()
  for (const e of edges) {
    if (!deckIds.has(e.fromNodeId)) kbIds.add(e.fromNodeId)
    if (!deckIds.has(e.toNodeId)) kbIds.add(e.toNodeId)
  }

  const kbNodes = kbIds.size
    ? await prisma.graphNode.findMany({ where: { id: { in: [...kbIds] } } })
    : []

  const nodeById = new Map([...deckNodes, ...kbNodes].map(n => [n.id, n]))

  const mappings = edges
    .filter(e => e.type === 'EXPRESSES' || e.type === 'REPRESENTS')
    .map(e => {
      const from = nodeById.get(e.fromNodeId)
      const to = nodeById.get(e.toNodeId)
      if (!from || !to) return null
      let slideId = ''
      let elementId = ''
      try {
        const props = JSON.parse(from.properties || '{}') as { slideId?: string; elementId?: string }
        slideId = props.slideId || ''
        elementId = props.elementId || ''
      } catch { /* */ }
      return {
        edgeType: e.type,
        slideId,
        elementId,
        elementName: from.name,
        knowledgeNodeId: to.id,
        knowledgeName: to.name,
        knowledgeType: to.type,
        confidence: e.confidence,
        evidenceText: e.evidenceText,
      }
    })
    .filter(Boolean)

  const slideTopicLinks = edges
    .filter(e => e.type === 'ABOUT')
    .map(e => {
      const from = nodeById.get(e.fromNodeId)
      const to = nodeById.get(e.toNodeId)
      if (!from || !to || from.type !== 'Slide' || to.type !== 'Topic') return null
      let slideId = ''
      try {
        slideId = (JSON.parse(from.properties || '{}') as { slideId?: string }).slideId || ''
      } catch { /* */ }
      return {
        slideId,
        slideName: from.name,
        topicNodeId: to.id,
        topicName: to.name,
        confidence: e.confidence,
      }
    })
    .filter(Boolean)

  return {
    presentationId,
    slideCount: deckNodes.filter(n => n.type === 'Slide').length,
    elementCount: deckNodes.filter(n => n.type === 'SlideElement').length,
    mappingCount: mappings.length,
    mappings,
    slideTopics: slideTopicLinks,
  }
}
