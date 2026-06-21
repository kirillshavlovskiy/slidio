import type { SlideData, SlideElement, SlideVersion } from './types'

/**
 * Git-commit-style diff between two deck snapshots. Used to give every saved
 * version a human-readable record of WHAT changed: which slides, which elements,
 * and (for edits) which fields — so the version history reads like a commit log.
 */

export type ChangeKind = 'added' | 'removed' | 'updated'

export interface ElementChange {
  id: string
  type: string
  label: string // short human label (content snippet, else type)
  kind: ChangeKind
  fields?: string[] // for "updated": which properties changed (friendly names)
}

export interface SlideChangeSummary {
  slideId: string
  slideIndex: number // 1-based position (in the after deck, or before deck if removed)
  title: string
  kind: 'added' | 'removed' | 'modified'
  bgChanged: boolean
  elements: ElementChange[]
}

export interface DeckChangeSummary {
  text: string // one-line headline, e.g. "3 slides · +2 ~5 −1 elements"
  slides: SlideChangeSummary[]
  totals: { slides: number; added: number; updated: number; removed: number }
}

function elementLabel(el: SlideElement): string {
  const content = (el.content || '').trim().replace(/\s+/g, ' ')
  if (content) return content.length > 32 ? content.slice(0, 32) + '…' : content
  return `${el.type} ${el.id.slice(0, 6)}`
}

function slideTitle(slide: SlideData): string {
  const t = slide.elements.find(e => e.type === 'text' && (e.content || '').trim())?.content
  return (t || '').trim().replace(/\s+/g, ' ').slice(0, 40) || '(untitled)'
}

// Friendly names for the element fields we care about reporting on.
const STYLE_FIELD_LABELS: Record<string, string> = {
  color: 'color',
  bg: 'fill',
  fontSize: 'font size',
  bold: 'bold',
  italic: 'italic',
  fontFace: 'font',
  fontWeight: 'weight',
  align: 'align',
  valign: 'valign',
  lineHeight: 'line height',
  charSpacing: 'spacing',
  opacity: 'opacity',
  borderRadius: 'corner radius',
  borderWidth: 'border',
  borderColor: 'border color',
}

function changedFields(before: SlideElement, after: SlideElement): string[] {
  const fields = new Set<string>()
  if ((before.content || '') !== (after.content || '')) fields.add('text')
  if (before.src !== after.src) fields.add('image')
  // Treat x/y as "position" and w/h as "size" (avoid noisy per-axis spam).
  if (before.x !== after.x || before.y !== after.y) fields.add('position')
  if (before.w !== after.w || before.h !== after.h) fields.add('size')
  const bs = before.style || {}
  const as = after.style || {}
  const keys = new Set([...Object.keys(bs), ...Object.keys(as)])
  keys.forEach(k => {
    if (JSON.stringify((bs as Record<string, unknown>)[k]) !== JSON.stringify((as as Record<string, unknown>)[k])) {
      fields.add(STYLE_FIELD_LABELS[k] || k)
    }
  })
  // chart spec (whole-object) change
  const beforeChart = (before as unknown as Record<string, unknown>).chart
  const afterChart = (after as unknown as Record<string, unknown>).chart
  if (JSON.stringify(beforeChart) !== JSON.stringify(afterChart)) {
    fields.add('chart')
  }
  return Array.from(fields)
}

export function summarizeDeckChanges(before: SlideData[], after: SlideData[]): DeckChangeSummary {
  const beforeById = new Map(before.map(s => [s.id, s]))
  const afterById = new Map(after.map(s => [s.id, s]))
  const slides: SlideChangeSummary[] = []
  let added = 0
  let updated = 0
  let removed = 0

  // Slides present in AFTER (added or modified).
  after.forEach((slide, i) => {
    const prev = beforeById.get(slide.id)
    if (!prev) {
      added += slide.elements.length
      slides.push({
        slideId: slide.id,
        slideIndex: i + 1,
        title: slideTitle(slide),
        kind: 'added',
        bgChanged: false,
        elements: slide.elements.map(el => ({
          id: el.id,
          type: el.type,
          label: elementLabel(el),
          kind: 'added' as const,
        })),
      })
      return
    }

    const prevEls = new Map(prev.elements.map(e => [e.id, e]))
    const nextEls = new Map(slide.elements.map(e => [e.id, e]))
    const elements: ElementChange[] = []

    slide.elements.forEach(el => {
      const old = prevEls.get(el.id)
      if (!old) {
        elements.push({ id: el.id, type: el.type, label: elementLabel(el), kind: 'added' })
        added++
      } else {
        const fields = changedFields(old, el)
        if (fields.length) {
          elements.push({ id: el.id, type: el.type, label: elementLabel(el), kind: 'updated', fields })
          updated++
        }
      }
    })
    prev.elements.forEach(el => {
      if (!nextEls.has(el.id)) {
        elements.push({ id: el.id, type: el.type, label: elementLabel(el), kind: 'removed' })
        removed++
      }
    })

    const bgChanged = prev.bg !== slide.bg
    if (elements.length || bgChanged) {
      slides.push({
        slideId: slide.id,
        slideIndex: i + 1,
        title: slideTitle(slide),
        kind: 'modified',
        bgChanged,
        elements,
      })
    }
  })

  // Slides present in BEFORE but not AFTER (removed).
  before.forEach((slide, i) => {
    if (!afterById.has(slide.id)) {
      removed += slide.elements.length
      slides.push({
        slideId: slide.id,
        slideIndex: i + 1,
        title: slideTitle(slide),
        kind: 'removed',
        bgChanged: false,
        elements: [],
      })
    }
  })

  const parts: string[] = [`${slides.length} slide${slides.length !== 1 ? 's' : ''}`]
  const elBits: string[] = []
  if (added) elBits.push(`+${added}`)
  if (updated) elBits.push(`~${updated}`)
  if (removed) elBits.push(`−${removed}`)
  if (elBits.length) parts.push(`${elBits.join(' ')} element${added + updated + removed !== 1 ? 's' : ''}`)

  return {
    text: parts.join(' · '),
    slides,
    totals: { slides: slides.length, added, updated, removed },
  }
}

/**
 * Formats recent version history on the current branch as an agent context block.
 * Helps the agent understand prior edits and avoid re-doing reverted work.
 * Returns empty string when there's nothing meaningful to show.
 */
export function buildVersionHistoryContext(
  versions: SlideVersion[],
  branchId: string,
  opts?: { limit?: number }
): string {
  const MAIN = 'main'
  const onBranch = versions
    .filter(v => (v.branchId ?? MAIN) === branchId)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, opts?.limit ?? 8)

  if (onBranch.length === 0) return ''

  const now = Date.now()
  const ago = (ts: number): string => {
    const s = Math.floor((now - ts) / 1000)
    if (s < 60) return `${s}s ago`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }

  const lines = onBranch.map(v => {
    const time = ago(v.timestamp)
    const named = v.label ? ` [${v.label}]` : ''
    const slideNote =
      v.changedSlideIds.length > 0
        ? ` · ${v.changedSlideIds.length} slide${v.changedSlideIds.length !== 1 ? 's' : ''} changed`
        : ''
    return `• ${time}${named} — ${v.changeLog}${slideNote}`
  })

  return (
    `\n=== DECK CHANGE HISTORY (most recent ${onBranch.length}) ===\n` +
    `Prior edits on this branch — use to avoid re-doing reverted work and to understand what the agent built before.\n\n` +
    lines.join('\n') +
    `\n=== END CHANGE HISTORY ===`
  )
}
