import { ElementStyle, SlideElement } from './types'

const FILL_TYPES = new Set<SlideElement['type']>(['bar', 'rect', 'chip'])

export function isFillElement(el: SlideElement): boolean {
  return FILL_TYPES.has(el.type)
}

/** Resolved fill hex (no #) for bars, rects, and chips. */
export function elementFillHex(el: SlideElement): string | undefined {
  const s = el.style ?? {}
  if (!isFillElement(el)) return undefined
  if (el.type === 'chip') return s.bg
  return s.bg || s.color
}

/** Resolved text hex (no #) for elements that display text. */
export function elementTextHex(el: SlideElement): string {
  return el.style?.color || 'FFFFFF'
}

/**
 * When AI patches `style.color` on a shape, treat it as fill (`bg`) unless
 * the element is plain text.
 */
export function normalizeElementPatch(
  el: SlideElement,
  patch: Partial<SlideElement> & { style?: ElementStyle }
): Partial<SlideElement> & { style?: ElementStyle } {
  // Always materialize a style object: the AI sometimes omits `style` entirely on
  // newly-added elements, which would leave el.style undefined and crash any code
  // that reads el.style.* (renderer, export, inspector).
  if (!patch.style) return { ...patch, style: {} }

  const style = { ...patch.style }

  // Bars and rects use style.bg for fill; AI often patches style.color by mistake
  if ((el.type === 'bar' || el.type === 'rect') && style.color && !style.bg) {
    style.bg = style.color
    if (el.type === 'bar') delete style.color
  }

  return { ...patch, style }
}
