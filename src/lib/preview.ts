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
  const ids = changes
    .filter(c => c.slideId === slideId && c.op !== 'delete')
    .map(c => (c.op === 'add' ? c.element?.id : c.elementId))
    .filter((id): id is string => !!id)
  return Array.from(new Set(ids))
}

function elementPatchDelta(
  before: SlideElement,
  after: SlideElement
): (Partial<SlideElement> & { style?: ElementStyle }) | null {
  const patch: Partial<SlideElement> & { style?: ElementStyle } = {}
  if (before.x !== after.x) patch.x = after.x
  if (before.y !== after.y) patch.y = after.y
  if (before.w !== after.w) patch.w = after.w
  if (before.h !== after.h) patch.h = after.h
  if ((before.content || '') !== (after.content || '')) patch.content = after.content
  if (before.icon !== after.icon) patch.icon = after.icon
  if (before.src !== after.src) patch.src = after.src
  if (JSON.stringify(before.chart) !== JSON.stringify(after.chart)) patch.chart = after.chart

  const bs = before.style || {}
  const as = after.style || {}
  const styleKeys = new Set([...Object.keys(bs), ...Object.keys(as)])
  const stylePatch: ElementStyle = {}
  for (const key of styleKeys) {
    const k = key as keyof ElementStyle
    if (JSON.stringify(bs[k]) !== JSON.stringify(as[k])) {
      stylePatch[k] = as[k] as never
    }
  }
  if (Object.keys(stylePatch).length) patch.style = stylePatch

  return Object.keys(patch).length ? patch : null
}

/** Collapse cumulative agent micro-patches into one net change per element/slide. */
export function buildNetChangesFromSnapshots(before: SlideData[], after: SlideData[]): Change[] {
  const changes: Change[] = []
  const beforeById = new Map(before.map(s => [s.id, s]))
  const afterById = new Map(after.map(s => [s.id, s]))

  for (const afterSlide of after) {
    const beforeSlide = beforeById.get(afterSlide.id)
    if (!beforeSlide) {
      changes.push({ slideId: afterSlide.id, op: 'add', slide: JSON.parse(JSON.stringify(afterSlide)) })
      continue
    }

    const slidePatch: Partial<SlideData> = {}
    if (beforeSlide.bg !== afterSlide.bg) slidePatch.bg = afterSlide.bg
    if (JSON.stringify(beforeSlide.bgGradient) !== JSON.stringify(afterSlide.bgGradient)) {
      slidePatch.bgGradient = afterSlide.bgGradient
    }
    if (Object.keys(slidePatch).length) {
      changes.push({ slideId: afterSlide.id, slidePatch })
    }

    const beforeEls = new Map(beforeSlide.elements.map(e => [e.id, e]))
    const afterEls = new Map(afterSlide.elements.map(e => [e.id, e]))

    for (const el of afterSlide.elements) {
      const old = beforeEls.get(el.id)
      if (!old) {
        changes.push({
          slideId: afterSlide.id,
          op: 'add',
          element: JSON.parse(JSON.stringify(el)) as SlideElement,
        })
        continue
      }
      const patch = elementPatchDelta(old, el)
      if (patch) {
        changes.push({ slideId: afterSlide.id, elementId: el.id, op: 'update', patch })
      }
    }

    for (const el of beforeSlide.elements) {
      if (!afterEls.has(el.id)) {
        changes.push({ slideId: afterSlide.id, elementId: el.id, op: 'delete' })
      }
    }
  }

  for (const beforeSlide of before) {
    if (!afterById.has(beforeSlide.id)) {
      changes.push({ slideId: beforeSlide.id, op: 'delete' })
    }
  }

  return changes
}

/** Prefer net snapshot diff when a checkpoint exists; fall back to raw pending list. */
export function resolveEffectivePendingChanges(
  pending: Change[] | null | undefined,
  checkpoint: SlideData[] | null | undefined,
  current: SlideData[]
): Change[] | null {
  if (checkpoint) {
    const net = buildNetChangesFromSnapshots(checkpoint, current)
    if (net.length) return net
  }
  if (!pending?.length) return null
  return pending
}

export function getDeletedElementIds(changes: Change[], slideId: string): string[] {
  return changes
    .filter(c => c.slideId === slideId && c.elementId && c.op === 'delete')
    .map(c => c.elementId!)
}

export function hasSlideLevelChange(changes: Change[], slideId: string): boolean {
  return changes.some(c => c.slideId === slideId && c.slidePatch)
}

/** Element id targeted by a change (add/update/delete/reorder), if any. */
export function changeElementId(c: Change): string | undefined {
  if (c.op === 'add' && c.element?.id) return c.element.id
  return c.elementId
}

export function changeTargetsElements(c: Change, elementIds: Set<string>): boolean {
  const id = changeElementId(c)
  return !!id && elementIds.has(id)
}

export function filterChangesByElements(changes: Change[], elementIds: string[]): Change[] {
  if (elementIds.length === 0) return []
  const set = new Set(elementIds)
  return changes.filter(c => changeTargetsElements(c, set))
}

export function excludeChangesByElements(changes: Change[], elementIds: string[]): Change[] {
  if (elementIds.length === 0) return changes
  const set = new Set(elementIds)
  return changes.filter(c => !changeTargetsElements(c, set))
}

export function getPendingSlideIds(changes: Change[]): string[] {
  return Array.from(new Set(changes.map(c => c.slideId).filter(Boolean)))
}

export function filterChangesBySlide(changes: Change[], slideId: string): Change[] {
  return changes.filter(c => c.slideId === slideId)
}

export function excludeChangesBySlide(changes: Change[], slideId: string): Change[] {
  return changes.filter(c => c.slideId !== slideId)
}

export function countChangesBySlide(changes: Change[], slideId: string): number {
  return filterChangesBySlide(changes, slideId).length
}

/** True when edits only move/resize/style elements — no copy or new substantive content. */
export function changesAreGeometryOnly(changes: Change[]): boolean {
  if (!changes.length) return true
  for (const c of changes) {
    if (c.op === 'delete') continue
    if (c.op === 'add' && c.slide) return false
    if (c.op === 'add' && c.element?.content?.trim()) return false
    if (c.patch?.content !== undefined && String(c.patch.content).trim()) return false
    if (c.element?.content?.trim()) return false
  }
  return true
}
