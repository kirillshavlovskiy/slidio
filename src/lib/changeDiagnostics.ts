import { Change, ElementStyle, SlideData } from '@/lib/types'

/**
 * Diagnostics for the AI edit pipeline.
 *
 * Given the slides that were in scope and the `changes` the model proposed, this
 * module reports — per change — whether the target exists, which fields are
 * recognized by the apply logic, and whether the change will actually take
 * effect. It exists so we can see exactly which customer instructions parse and
 * apply vs. which are silently dropped or remapped.
 */

const RECOGNIZED_STYLE_KEYS: string[] = [
  'fontSize',
  'bold',
  'italic',
  'color',
  'bg',
  'align',
  'valign',
  'charSpacing',
  'fontFace',
  'padLeft',
  'padRight',
  'padTop',
  'padBottom',
  'fontWeight',
  'lineHeight',
  'opacity',
  'borderRadius',
  'borderWidth',
  'borderColor',
  'borderStyle',
  'invert',
  'objectFit',
]

// Top-level element patch keys that the apply logic (applyChangesToSlides) honors.
const RECOGNIZED_PATCH_KEYS: string[] = [
  'content',
  'src',
  'x',
  'y',
  'w',
  'h',
  'type',
  'style',
  'chart',
  'icon',
]

// Slide-level patch keys that render. (elements/id are intentionally NOT here —
// applying them would wholesale-overwrite the slide.)
const RECOGNIZED_SLIDE_PATCH_KEYS: string[] = ['bg']

export type ChangeKind =
  | 'element-add'
  | 'element-update'
  | 'element-delete'
  | 'element-reorder'
  | 'slide-add'
  | 'slide-update'
  | 'slide-delete'
  | 'unknown'

export interface ChangeDiagnostic {
  index: number
  kind: ChangeKind
  slideId: string
  elementId?: string
  op?: string
  slideFound: boolean
  elementFound: boolean
  elementType?: string
  recognizedFields: string[]
  unknownFields: string[]
  recognizedStyleKeys: string[]
  unknownStyleKeys: string[]
  willApply: boolean
  notes: string[]
}

export interface ChangeReport {
  total: number
  willApply: number
  skipped: number
  diagnostics: ChangeDiagnostic[]
}

export function analyzeChanges(
  slides: SlideData[],
  changes: Change[] | undefined
): ChangeReport {
  const list = Array.isArray(changes) ? changes : []
  const diagnostics: ChangeDiagnostic[] = list.map((change, index) => {
    const notes: string[] = []
    const slide = slides.find(s => s.id === change.slideId)
    const slideFound = !!slide
    let elementFound = false
    let elementType: string | undefined
    let kind: ChangeKind = 'unknown'
    let willApply = false
    const recognizedFields: string[] = []
    const unknownFields: string[] = []
    const recognizedStyleKeys: string[] = []
    const unknownStyleKeys: string[] = []

    const isDelete = change.op === 'delete'
    const isAdd = change.op === 'add'
    const isReorder = change.op === 'reorder'

    if (isAdd && change.slide) {
      kind = 'slide-add'
      const s = change.slide
      const requiredOk = !!s && typeof s.id === 'string' && Array.isArray(s.elements)
      const idTaken = slides.some(existing => existing.id === s?.id)
      willApply = requiredOk && !idTaken
      if (!requiredOk) notes.push('op:"add" slide missing id/elements → dropped')
      else if (idTaken) notes.push(`slide id "${s.id}" already exists → dropped`)
    } else if (isReorder) {
      kind = 'element-reorder'
      const el = slide?.elements.find(e => e.id === change.elementId)
      elementFound = !!el
      elementType = el?.type
      willApply = slideFound && elementFound && !!change.elementId
      if (!slideFound) notes.push(`slide "${change.slideId}" not found in scope`)
      else if (!change.elementId) notes.push('op:"reorder" needs an elementId → dropped')
      else if (!elementFound) notes.push(`element "${change.elementId}" not found on slide`)
    } else if (isAdd) {
      kind = 'element-add'
      const el = change.element
      elementType = el?.type
      const requiredOk =
        !!el &&
        typeof el.id === 'string' &&
        typeof el.type === 'string' &&
        typeof el.x === 'number' &&
        typeof el.y === 'number' &&
        typeof el.w === 'number' &&
        typeof el.h === 'number'
      willApply = slideFound && requiredOk
      if (!slideFound) notes.push(`slide "${change.slideId}" not found in scope`)
      if (!el) notes.push('op:"add" but no "element" object provided → dropped')
      else if (!requiredOk)
        notes.push('new element missing required fields (id/type/x/y/w/h) → dropped')
      else if (slide?.elements.some(e => e.id === el.id))
        notes.push(`element id "${el.id}" already exists on slide → will be replaced`)
    } else if (isDelete && !change.elementId) {
      kind = 'slide-delete'
      willApply = slideFound
      if (!slideFound) notes.push(`slide "${change.slideId}" not found in scope`)
    } else if (isDelete && change.elementId) {
      kind = 'element-delete'
      const el = slide?.elements.find(e => e.id === change.elementId)
      elementFound = !!el
      elementType = el?.type
      willApply = slideFound && elementFound
      if (!slideFound) notes.push(`slide "${change.slideId}" not found in scope`)
      else if (!elementFound) notes.push(`element "${change.elementId}" not found on slide`)
    } else if (change.elementId && change.patch) {
      kind = 'element-update'
      const el = slide?.elements.find(e => e.id === change.elementId)
      elementFound = !!el
      elementType = el?.type
      const patch = change.patch as Record<string, unknown>
      for (const key of Object.keys(patch)) {
        if (RECOGNIZED_PATCH_KEYS.includes(key)) recognizedFields.push(key)
        else unknownFields.push(key)
      }
      const style = (patch.style && typeof patch.style === 'object' ? patch.style : null) as
        | ElementStyle
        | null
      if (style) {
        for (const sk of Object.keys(style)) {
          if (RECOGNIZED_STYLE_KEYS.includes(sk)) recognizedStyleKeys.push(sk)
          else unknownStyleKeys.push(sk)
        }
      }
      const hasMeaningful =
        recognizedFields.some(f => f !== 'style') || recognizedStyleKeys.length > 0
      willApply = slideFound && elementFound && hasMeaningful
      if (!slideFound) notes.push(`slide "${change.slideId}" not found in scope`)
      else if (!elementFound) notes.push(`element "${change.elementId}" not found on slide`)
      if (slideFound && elementFound && !hasMeaningful)
        notes.push('patch has no recognized fields — nothing would change')
      if (unknownFields.length)
        notes.push(`unrecognized patch fields ignored: ${unknownFields.join(', ')}`)
      if (unknownStyleKeys.length)
        notes.push(`unrecognized style keys ignored: ${unknownStyleKeys.join(', ')}`)
      if (el && (el.type === 'bar' || el.type === 'rect') && style?.color && !style.bg)
        notes.push(`style.color will be remapped to style.bg for ${el.type} (fill, not font)`)
    } else if (change.elementId && !change.patch) {
      kind = 'element-update'
      const el = slide?.elements.find(e => e.id === change.elementId)
      elementFound = !!el
      elementType = el?.type
      willApply = false
      notes.push('elementId present but no patch and no op:"delete" → dropped (no-op)')
    } else if (change.slidePatch) {
      kind = 'slide-update'
      const sp = change.slidePatch as Record<string, unknown>
      for (const key of Object.keys(sp)) {
        if (RECOGNIZED_SLIDE_PATCH_KEYS.includes(key)) recognizedFields.push(key)
        else unknownFields.push(key)
      }
      willApply = slideFound && recognizedFields.length > 0
      if (!slideFound) notes.push(`slide "${change.slideId}" not found in scope`)
      if (unknownFields.length)
        notes.push(`unrecognized slidePatch fields: ${unknownFields.join(', ')}`)
      if ('elements' in sp || 'id' in sp)
        notes.push('slidePatch contains elements/id → risk of wholesale slide overwrite')
    } else {
      kind = 'unknown'
      willApply = false
      notes.push(
        'change matches no supported shape (needs patch, slidePatch, or op:"delete")'
      )
    }

    return {
      index,
      kind,
      slideId: change.slideId,
      elementId: change.elementId,
      op: change.op,
      slideFound,
      elementFound,
      elementType,
      recognizedFields,
      unknownFields,
      recognizedStyleKeys,
      unknownStyleKeys,
      willApply,
      notes,
    }
  })

  const willApply = diagnostics.filter(d => d.willApply).length
  return {
    total: list.length,
    willApply,
    skipped: list.length - willApply,
    diagnostics,
  }
}

/** Human-readable multi-line summary suitable for console logging. */
export function formatChangeReport(report: ChangeReport): string {
  const lines: string[] = []
  lines.push(
    `changes: ${report.total} total · ${report.willApply} will apply · ${report.skipped} skipped/no-op`
  )
  for (const d of report.diagnostics) {
    const target = d.elementId
      ? `${d.slideId}/${d.elementId}${d.elementType ? ` (${d.elementType})` : ''}`
      : d.slideId
    const status = d.willApply ? 'APPLY' : 'SKIP '
    const fields = [
      ...d.recognizedFields.filter(f => f !== 'style'),
      ...(d.recognizedStyleKeys.length ? [`style{${d.recognizedStyleKeys.join(',')}}`] : []),
    ].join(' ')
    lines.push(`  [${status}] #${d.index} ${d.kind} ${target}${fields ? ' -> ' + fields : ''}`)
    for (const note of d.notes) lines.push(`           - ${note}`)
  }
  return lines.join('\n')
}
