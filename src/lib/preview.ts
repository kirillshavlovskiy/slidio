import { Change, ElementStyle, SlideData, SlideElement } from './types'
import { normalizeElementPatch } from './elementStyle'

function clampIndex(value: number | undefined, max: number): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined
  return Math.max(0, Math.min(Math.floor(value), max))
}

export function getDeletedSlideIds(changes: Change[]): string[] {
  return changes
    .filter(c => c.op === 'delete' && !c.elementId)
    .map(c => c.slideId)
}

export function applyChangesToSlides(slides: SlideData[], changes: Change[]): SlideData[] {
  const deletedSlideIds = new Set(getDeletedSlideIds(changes))
  const updated = (JSON.parse(JSON.stringify(slides)) as SlideData[]).filter(
    s => !deletedSlideIds.has(s.id)
  )

  for (const change of changes) {
    if (change.op === 'delete' && !change.elementId) continue

    // Deck-level: add a brand-new slide (op "add" with a `slide`, no elementId/element).
    if (change.op === 'add' && change.slide) {
      const incoming = JSON.parse(JSON.stringify(change.slide)) as SlideData
      incoming.elements = (incoming.elements || []).map(
        e => normalizeElementPatch(e, e) as SlideElement
      )
      if (!updated.some(s => s.id === incoming.id)) {
        const at = clampIndex(change.index, updated.length) ?? updated.length
        updated.splice(at, 0, incoming)
      }
      continue
    }

    const slide = updated.find(s => s.id === change.slideId)
    if (!slide) continue

    if (change.op === 'add' && change.element) {
      const newEl = normalizeElementPatch(change.element, change.element) as SlideElement
      // Replace if an element with this id already exists (keeps re-apply idempotent),
      // otherwise insert at the requested z-position (0 = back) or append (front).
      const existingIdx = slide.elements.findIndex(e => e.id === newEl.id)
      if (existingIdx >= 0) {
        slide.elements[existingIdx] = newEl
      } else {
        const at = clampIndex(change.index, slide.elements.length)
        if (at === undefined) slide.elements.push(newEl)
        else slide.elements.splice(at, 0, newEl)
      }
      continue
    }

    // Re-layer an existing element (z-order). index 0 = back, last = front.
    if (change.op === 'reorder' && change.elementId) {
      const from = slide.elements.findIndex(e => e.id === change.elementId)
      if (from >= 0) {
        const [moved] = slide.elements.splice(from, 1)
        const at = clampIndex(change.index, slide.elements.length) ?? slide.elements.length
        slide.elements.splice(at, 0, moved)
      }
      continue
    }

    if (change.elementId) {
      if (change.op === 'delete') {
        slide.elements = slide.elements.filter(e => e.id !== change.elementId)
        continue
      }

      const el = slide.elements.find(e => e.id === change.elementId)
      if (el && change.patch) {
        const patch = normalizeElementPatch(el, change.patch)
        Object.assign(el, {
          ...patch,
          style: { ...el.style, ...(patch.style || {}) },
        })
      }
    } else if (change.slidePatch) {
      Object.assign(slide, change.slidePatch)
    }
  }

  return updated
}

export interface ChangeField {
  field: string
  before: string
  after: string
}

export interface ChangeDetail {
  slideId: string
  elementId?: string
  label: string
  op: 'update' | 'delete' | 'delete-slide' | 'slide' | 'add'
  fields: ChangeField[]
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

function elementLabel(el: SlideElement | undefined, elementId?: string): string {
  if (!el) return elementId || 'Unknown element'
  const snippet = el.content?.replace(/\n/g, ' ').trim().slice(0, 40)
  return snippet ? `"${snippet}${el.content!.length > 40 ? '…' : ''}"` : el.id
}

function slideLabel(slide: SlideData | undefined, slideId: string, index: number): string {
  if (!slide) return `Slide ${index + 1}`
  const headline = slide.elements.find(el => el.content?.trim())?.content?.trim()
  if (headline) {
    const oneLine = headline.replace(/\s+/g, ' ')
    return oneLine.length > 42 ? `${oneLine.slice(0, 42)}…` : oneLine
  }
  return `Slide ${index + 1}`
}

export function getChangeDetails(slides: SlideData[], changes: Change[]): ChangeDetail[] {
  return changes.map(change => {
    const slide = slides.find(s => s.id === change.slideId)
    const slideIndex = slides.findIndex(s => s.id === change.slideId)
    const fields: ChangeField[] = []

    if (change.op === 'delete' && !change.elementId) {
      return {
        slideId: change.slideId,
        label: slideLabel(slide, change.slideId, slideIndex),
        op: 'delete-slide',
        fields: [{ field: 'slide', before: 'present', after: 'deleted' }],
      }
    }

    if (change.op === 'add' && change.slide) {
      return {
        slideId: change.slide.id,
        label: `New slide`,
        op: 'add',
        fields: [
          { field: 'slide', before: '—', after: change.slide.id },
          { field: 'elements', before: '—', after: String(change.slide.elements?.length ?? 0) },
        ],
      }
    }

    if (change.op === 'reorder' && change.elementId) {
      const el = slide?.elements.find(e => e.id === change.elementId)
      return {
        slideId: change.slideId,
        elementId: change.elementId,
        label: elementLabel(el, change.elementId),
        op: 'update',
        fields: [
          {
            field: 'z-order',
            before: 'current',
            after: typeof change.index === 'number' ? `index ${change.index}` : 'front',
          },
        ],
      }
    }

    if (change.op === 'add' && change.element) {
      const el = change.element
      fields.push({ field: 'type', before: '—', after: formatValue(el.type) })
      if (el.content) fields.push({ field: 'content', before: '—', after: formatValue(el.content) })
      fields.push({
        field: 'position',
        before: '—',
        after: `${el.x},${el.y} · ${el.w}×${el.h}`,
      })
      return {
        slideId: change.slideId,
        elementId: el.id,
        label: elementLabel(el, el.id),
        op: 'add',
        fields,
      }
    }

    if (change.slidePatch) {
      for (const [key, after] of Object.entries(change.slidePatch)) {
        fields.push({
          field: key,
          before: formatValue(key === 'bg' ? slide?.bg : undefined),
          after: formatValue(after),
        })
      }

      return {
        slideId: change.slideId,
        label: `Slide background`,
        op: 'slide',
        fields,
      }
    }

    const el = slide?.elements.find(e => e.id === change.elementId)

    if (change.op === 'delete') {
      return {
        slideId: change.slideId,
        elementId: change.elementId,
        label: elementLabel(el, change.elementId),
        op: 'delete',
        fields: [{ field: 'element', before: 'present', after: 'deleted' }],
      }
    }

    if (change.patch) {
      for (const [key, value] of Object.entries(change.patch)) {
        if (key === 'style' && value) {
          for (const [styleKey, styleValue] of Object.entries(value as ElementStyle)) {
            fields.push({
              field: styleKey,
              before: formatValue(el?.style?.[styleKey as keyof ElementStyle]),
              after: formatValue(styleValue),
            })
          }
        } else {
          fields.push({
            field: key,
            before: formatValue((el as Record<string, unknown> | undefined)?.[key]),
            after: formatValue(value),
          })
        }
      }
    }

    return {
      slideId: change.slideId,
      elementId: change.elementId,
      label: elementLabel(el, change.elementId),
      op: 'update',
      fields,
    }
  })
}

export function getAffectedElementIds(changes: Change[], slideId: string): string[] {
  return changes
    .filter(c => c.slideId === slideId && c.op !== 'delete')
    .map(c => (c.op === 'add' ? c.element?.id : c.elementId))
    .filter((id): id is string => !!id)
}

export function getDeletedElementIds(changes: Change[], slideId: string): string[] {
  return changes
    .filter(c => c.slideId === slideId && c.elementId && c.op === 'delete')
    .map(c => c.elementId!)
}

export function hasSlideLevelChange(changes: Change[], slideId: string): boolean {
  return changes.some(c => c.slideId === slideId && c.slidePatch)
}
