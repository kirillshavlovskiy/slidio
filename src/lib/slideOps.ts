import { SlideData, SlideElement } from './types'

let counter = 0

function uid(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function cloneElementsWithNewIds(elements: SlideElement[]): SlideElement[] {
  return elements.map(el => ({ ...deepClone(el), id: uid('el') }))
}

export interface SlideOpResult {
  slides: SlideData[]
  activeSlideId: string
  selectedSlideIds: string[]
  changed: boolean
}

/** Duplicate every selected slide, inserting each copy right after its original. */
export function duplicateSlides(slides: SlideData[], selectedIds: string[]): SlideOpResult {
  const idSet = new Set(selectedIds)
  if (slides.length === 0 || idSet.size === 0) {
    return { slides, activeSlideId: selectedIds[0] ?? '', selectedSlideIds: selectedIds, changed: false }
  }

  const result: SlideData[] = []
  const newIds: string[] = []
  for (const slide of slides) {
    result.push(slide)
    if (idSet.has(slide.id)) {
      const copy: SlideData = {
        id: uid('slide'),
        bg: slide.bg,
        elements: cloneElementsWithNewIds(slide.elements),
      }
      result.push(copy)
      newIds.push(copy.id)
    }
  }

  return {
    slides: result,
    activeSlideId: newIds[0] ?? slides[0].id,
    selectedSlideIds: newIds.length > 0 ? newIds : selectedIds,
    changed: newIds.length > 0,
  }
}

/**
 * Split a slide into two slides. Elements are divided by their vertical center:
 * the top half stays on the original slide, the bottom half moves to a new slide
 * inserted directly after it. Element positions are preserved.
 */
export function splitSlide(slides: SlideData[], slideId: string): SlideOpResult {
  const index = slides.findIndex(s => s.id === slideId)
  if (index === -1) {
    return { slides, activeSlideId: slideId, selectedSlideIds: [slideId], changed: false }
  }

  const slide = slides[index]
  if (slide.elements.length < 2) {
    return { slides, activeSlideId: slideId, selectedSlideIds: [slideId], changed: false }
  }

  const sorted = [...slide.elements].sort(
    (a, b) => a.y + a.h / 2 - (b.y + b.h / 2)
  )
  const mid = Math.ceil(sorted.length / 2)
  const topIds = new Set(sorted.slice(0, mid).map(e => e.id))

  const firstElements = slide.elements.filter(e => topIds.has(e.id))
  const secondElements = slide.elements.filter(e => !topIds.has(e.id))

  const updatedFirst: SlideData = { ...slide, elements: firstElements.map(e => deepClone(e)) }
  const newSlide: SlideData = {
    id: uid('slide'),
    bg: slide.bg,
    elements: secondElements.map(e => deepClone(e)),
  }

  const result = [...slides]
  result[index] = updatedFirst
  result.splice(index + 1, 0, newSlide)

  return {
    slides: result,
    activeSlideId: updatedFirst.id,
    selectedSlideIds: [updatedFirst.id, newSlide.id],
    changed: true,
  }
}

/**
 * Merge all selected slides into a single slide placed at the position of the
 * first selected slide. Elements keep their positions (regenerated ids) so the
 * combined slide can be rearranged afterwards.
 */
export function mergeSlides(slides: SlideData[], selectedIds: string[]): SlideOpResult {
  const idSet = new Set(selectedIds)
  const selectedInOrder = slides.filter(s => idSet.has(s.id))
  if (selectedInOrder.length < 2) {
    return {
      slides,
      activeSlideId: selectedIds[0] ?? slides[0]?.id ?? '',
      selectedSlideIds: selectedIds,
      changed: false,
    }
  }

  const target = selectedInOrder[0]
  const mergedElements: SlideElement[] = []
  for (const slide of selectedInOrder) {
    mergedElements.push(...cloneElementsWithNewIds(slide.elements))
  }

  const mergedSlide: SlideData = {
    id: uid('slide'),
    bg: target.bg,
    elements: mergedElements,
  }

  const result: SlideData[] = []
  let inserted = false
  for (const slide of slides) {
    if (idSet.has(slide.id)) {
      if (!inserted) {
        result.push(mergedSlide)
        inserted = true
      }
    } else {
      result.push(slide)
    }
  }

  return {
    slides: result,
    activeSlideId: mergedSlide.id,
    selectedSlideIds: [mergedSlide.id],
    changed: true,
  }
}
