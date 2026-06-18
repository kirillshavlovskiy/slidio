import type { SlideData, SlideElement } from '@/lib/types'
import { createGraphEdge } from './edges'
import { upsertDeckNode, deckRefKey } from './nodes'
import { validateEdgeCreation } from './validate'

export function elementDisplayText(el: SlideElement): string {
  if (el.type === 'text' || el.type === 'chip') return (el.content || '').trim()
  if (el.type === 'chart' && el.chart) {
    const c = el.chart
    const parts = [
      c.title,
      ...c.categories,
      ...c.series.flatMap(s => [s.name, ...s.values.map(String)]),
    ].filter(Boolean)
    return parts.join(' · ')
  }
  if (el.type === 'icon' && el.icon) return `[icon: ${el.icon}]`
  return ''
}

export function slideTitle(slide: SlideData, index: number): string {
  const textEl = slide.elements.find(
    e => (e.type === 'text' || e.type === 'chip') && (e.content || '').trim()
  )
  const raw = textEl?.content?.trim() || ''
  const firstLine = raw.split('\n')[0]?.trim() || ''
  if (firstLine.length >= 3) return firstLine.slice(0, 80)
  return `Slide ${index + 1}`
}

export type ProjectDeckResult = {
  presentationNodeId: string
  slideCount: number
  elementCount: number
  slideNodeIds: Map<string, string>
  elementNodeIds: Map<string, string>
}

/** Project presentation JSON into deck graph structure nodes + HAS_SLIDE / CONTAINS_ELEMENT edges. */
export async function projectDeckGraph(input: {
  branchId: string
  presentationId: string
  presentationName: string
  slides: SlideData[]
}): Promise<ProjectDeckResult> {
  const { branchId, presentationId, presentationName, slides } = input

  const presRef = deckRefKey('Presentation', presentationId)
  const presNode = await upsertDeckNode({
    branchId,
    type: 'Presentation',
    deckType: 'Presentation',
    name: presentationName,
    presentationId,
    refKey: presRef,
    properties: { presentationId },
    createdBy: 'ai_agent',
    confidence: 1,
  })

  const slideNodeIds = new Map<string, string>()
  const elementNodeIds = new Map<string, string>()
  let elementCount = 0

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i]
    const title = slideTitle(slide, i)
    const slideRef = deckRefKey('Slide', presentationId, slide.id)

    const slideNode = await upsertDeckNode({
      branchId,
      type: 'Slide',
      deckType: 'Slide',
      name: title,
      description: slide.elements.map(elementDisplayText).filter(Boolean).join('\n').slice(0, 300) || null,
      presentationId,
      slideId: slide.id,
      refKey: slideRef,
      properties: { presentationId, slideId: slide.id, ordinal: i },
      createdBy: 'ai_agent',
      confidence: 1,
    })
    slideNodeIds.set(slide.id, slideNode.id)

    if (validateEdgeCreation('HAS_SLIDE', 'Presentation', 'Slide')) {
      await createGraphEdge({
        branchId,
        fromNodeId: presNode.id,
        toNodeId: slideNode.id,
        type: 'HAS_SLIDE',
        confidence: 1,
      })
    }

    for (const el of slide.elements) {
      const text = elementDisplayText(el)
      const label =
        text.slice(0, 60) ||
        (el.type === 'chart' ? 'Chart' : el.type === 'image' ? 'Image' : el.type)
      const elemRef = deckRefKey('SlideElement', presentationId, slide.id, el.id)

      const elemNode = await upsertDeckNode({
        branchId,
        type: 'SlideElement',
        deckType: 'SlideElement',
        name: label,
        description: text.slice(0, 400) || null,
        presentationId,
        slideId: slide.id,
        elementId: el.id,
        refKey: elemRef,
        properties: {
          presentationId,
          slideId: slide.id,
          elementId: el.id,
          elementType: el.type,
        },
        createdBy: 'ai_agent',
        confidence: 1,
      })
      elementNodeIds.set(`${slide.id}:${el.id}`, elemNode.id)
      elementCount++

      if (validateEdgeCreation('CONTAINS_ELEMENT', 'Slide', 'SlideElement')) {
        await createGraphEdge({
          branchId,
          fromNodeId: slideNode.id,
          toNodeId: elemNode.id,
          type: 'CONTAINS_ELEMENT',
          confidence: 1,
        })
      }
    }
  }

  return {
    presentationNodeId: presNode.id,
    slideCount: slides.length,
    elementCount,
    slideNodeIds,
    elementNodeIds,
  }
}
