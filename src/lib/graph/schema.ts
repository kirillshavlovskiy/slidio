/** Knowledge graph node types — KB (Phase 0–1) + deck (Phase 2). */
export const KB_NODE_TYPES = [
  'SourceDocument',
  'DocumentChunk',
  'Topic',
  'Claim',
  'Metric',
] as const

export const DECK_NODE_TYPES = ['Presentation', 'Slide', 'SlideElement'] as const

export const GRAPH_NODE_TYPES = [...KB_NODE_TYPES, ...DECK_NODE_TYPES] as const

export type GraphNodeType = (typeof GRAPH_NODE_TYPES)[number]

export type KbNodeType = (typeof KB_NODE_TYPES)[number]
export type DeckNodeType = (typeof DECK_NODE_TYPES)[number]

export const KB_EDGE_TYPES = ['SUPPORTED_BY', 'ABOUT', 'PART_OF'] as const

export const DECK_EDGE_TYPES = ['HAS_SLIDE', 'CONTAINS_ELEMENT', 'EXPRESSES', 'REPRESENTS'] as const

export const GRAPH_EDGE_TYPES = [...KB_EDGE_TYPES, ...DECK_EDGE_TYPES] as const

export type GraphEdgeType = (typeof GRAPH_EDGE_TYPES)[number]

export const NODE_STATUSES = ['candidate', 'approved', 'rejected'] as const
export type NodeStatus = (typeof NODE_STATUSES)[number]

export const SOURCE_STATUSES = ['registered', 'parsed', 'extracted', 'failed'] as const
export type SourceStatus = (typeof SOURCE_STATUSES)[number]

export const MIN_CONFIDENCE = 0.5

export function isGraphNodeType(v: string): v is GraphNodeType {
  return (GRAPH_NODE_TYPES as readonly string[]).includes(v)
}

export function isGraphEdgeType(v: string): v is GraphEdgeType {
  return (GRAPH_EDGE_TYPES as readonly string[]).includes(v)
}

export function isDeckNodeType(v: string): v is DeckNodeType {
  return (DECK_NODE_TYPES as readonly string[]).includes(v)
}

export function deckRefKey(
  type: DeckNodeType,
  presentationId: string,
  slideId?: string,
  elementId?: string
): string {
  if (type === 'Presentation') return `pres:${presentationId}`
  if (type === 'Slide') return `slide:${presentationId}:${slideId}`
  return `elem:${presentationId}:${slideId}:${elementId}`
}
