import { CANVAS_PX_PER_IN } from '@/lib/slideDimensions'
import type { DeckComment, SlideData } from '@/lib/types'

const SCALE = CANVAS_PX_PER_IN

/** Find the topmost element under a canvas point (960×720 space). */
export function elementAtCanvasPoint(slide: SlideData, x: number, y: number): string | null {
  for (let i = slide.elements.length - 1; i >= 0; i--) {
    const el = slide.elements[i]
    const left = el.x * SCALE
    const top = el.y * SCALE
    const w = el.w * SCALE
    const h = el.h * SCALE
    if (x >= left && x <= left + w && y >= top && y <= top + h) return el.id
  }
  return null
}

export type CommentPinDraft = {
  slideId: string
  elementId: string | null
  pinX: number
  pinY: number
}

export function commentsOnSlide(comments: DeckComment[], slideId: string): DeckComment[] {
  return comments.filter(c => c.slideId === slideId && c.pinX != null && c.pinY != null)
}
