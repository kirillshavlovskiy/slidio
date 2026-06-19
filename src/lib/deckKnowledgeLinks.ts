export type DeckElementLink = {
  slideId: string
  elementId: string
  elementName: string
  knowledgeNodeId: string
  knowledgeName: string
  knowledgeType: string
  edgeType: string
  confidence: number
  evidenceText?: string | null
}

export type DeckLinkIndex = {
  byElementId: Map<string, DeckElementLink>
  bySlideId: Map<string, DeckElementLink[]>
  linkedSlideIds: Set<string>
}

export function indexDeckElementLinks(mappings: DeckElementLink[]): DeckLinkIndex {
  const byElementId = new Map<string, DeckElementLink>()
  const bySlideId = new Map<string, DeckElementLink[]>()
  const linkedSlideIds = new Set<string>()

  for (const m of mappings) {
    if (!m.slideId || !m.elementId) continue
    byElementId.set(m.elementId, m)
    const list = bySlideId.get(m.slideId) ?? []
    list.push(m)
    bySlideId.set(m.slideId, list)
    linkedSlideIds.add(m.slideId)
  }

  return { byElementId, bySlideId, linkedSlideIds }
}

/** Snap targets for knowledge-linked elements — only other linked siblings on the slide. */
export function knowledgeSnapTargets<T extends { id: string }>(
  all: T[],
  movingIds: string[],
  linkedElementIds: Set<string>
): T[] {
  if (!linkedElementIds.size) return all
  if (!movingIds.some(id => linkedElementIds.has(id))) return all
  const linkedOthers = all.filter(el => linkedElementIds.has(el.id) && !movingIds.includes(el.id))
  return linkedOthers.length > 0 ? linkedOthers : []
}
