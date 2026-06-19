import { MIN_CONFIDENCE, type GraphEdgeType, type GraphNodeType } from './schema'

export type ExtractedItem = {
  type: 'Topic' | 'Claim' | 'Metric'
  name: string
  description?: string
  confidence: number
  evidenceText?: string
  topicName?: string
}

export function normalizeClaimKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function filterExtractions(items: ExtractedItem[], chunkText: string): ExtractedItem[] {
  const chunkLower = chunkText.toLowerCase()
  const seen = new Set<string>()
  const out: ExtractedItem[] = []

  for (const item of items) {
    if (item.confidence < MIN_CONFIDENCE) continue
    if (!item.name?.trim()) continue

    if (item.type === 'Claim' || item.type === 'Metric') {
      const evidence = (item.evidenceText || item.description || '').trim()
      if (!evidence) continue
      const evidenceLower = evidence.toLowerCase()
      if (!chunkLower.includes(evidenceLower.slice(0, Math.min(80, evidenceLower.length)))) {
        // Allow partial grounding: at least 20 chars must appear in chunk
        const probe = evidenceLower.slice(0, 40)
        if (probe.length >= 10 && !chunkLower.includes(probe)) continue
      }
    }

    const dedupeKey =
      item.type === 'Claim'
        ? `${item.type}:${normalizeClaimKey(item.name)}`
        : `${item.type}:${item.name.toLowerCase().trim()}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    out.push(item)
  }

  return out
}

export function validateEdgeCreation(
  edgeType: GraphEdgeType,
  fromType: GraphNodeType,
  toType: GraphNodeType
): boolean {
  switch (edgeType) {
    case 'SUPPORTED_BY':
      return (
        (fromType === 'Claim' || fromType === 'Metric' || fromType === 'Topic') &&
        toType === 'DocumentChunk'
      ) || (fromType === 'SlideElement' && toType === 'DocumentChunk')
    case 'ABOUT':
      return (
        (fromType === 'Claim' && toType === 'Topic') ||
        (fromType === 'Metric' && toType === 'Topic') ||
        (fromType === 'Topic' && toType === 'Topic') ||
        (fromType === 'Slide' && toType === 'Topic')
      )
    case 'PART_OF':
      return fromType === 'DocumentChunk' && toType === 'SourceDocument'
    case 'HAS_SLIDE':
      return fromType === 'Presentation' && toType === 'Slide'
    case 'CONTAINS_ELEMENT':
      return fromType === 'Slide' && toType === 'SlideElement'
    case 'EXPRESSES':
      return fromType === 'SlideElement' && toType === 'Claim'
    case 'REPRESENTS':
      return fromType === 'SlideElement' && toType === 'Metric'
    default:
      return false
  }
}

export function requireSupportEdge(nodeType: GraphNodeType): boolean {
  return nodeType === 'Claim' || nodeType === 'Metric'
}
