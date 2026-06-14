import { SlideData } from './types'

export type ScopeMode = 'active' | 'multi' | 'full'

export interface ResolvedScope {
  mode: ScopeMode
  slides: SlideData[]
}

/** The scope decision the LLM router returns (see /api/route). */
export type RouterScope = 'active' | 'selected' | 'deck' | 'ask'

/**
 * Deterministically turn the LLM router's scope decision into the concrete slide
 * set sent to the edit API. There is NO text/keyword parsing here — the router
 * (an LLM) makes the semantic call; this only maps that decision onto state.
 */
export function slidesForScope(
  decision: RouterScope,
  activeSlideId: string,
  selectedSlideIds: string[],
  allSlides: SlideData[]
): ResolvedScope {
  if (decision === 'deck') {
    return { mode: 'full', slides: allSlides }
  }

  if (decision === 'selected' && selectedSlideIds.length > 1) {
    const selected = allSlides.filter(s => selectedSlideIds.includes(s.id))
    if (selected.length > 0) return { mode: 'multi', slides: selected }
  }

  // 'active' (or 'selected' with a single selection / 'ask' fallback): the one
  // currently-focused slide.
  const singleId = selectedSlideIds[0] || activeSlideId
  const slide = allSlides.find(s => s.id === singleId) ?? allSlides[0]
  return { mode: 'active', slides: slide ? [slide] : [] }
}
