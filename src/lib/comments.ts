import { actorDisplayName } from './actorInfo'
import type { DeckComment, SlideData } from './types'

const MAX_COMMENT_CHARS = 2000
const DEFAULT_CHAR_BUDGET = 4000

function slideLabel(slides: SlideData[], slideId: string | null | undefined): string {
  if (!slideId) return 'Deck-wide'
  const idx = slides.findIndex(s => s.id === slideId)
  if (idx < 0) return `Slide ${slideId}`
  const title =
    slides[idx].elements.find(e => e.type === 'text' && e.content?.trim())?.content?.slice(0, 48) ??
    'Untitled'
  return `Slide ${idx + 1}: ${title}`
}

function elementLabel(slides: SlideData[], slideId: string | null | undefined, elementId: string | null | undefined): string {
  if (!elementId || !slideId) return ''
  const slide = slides.find(s => s.id === slideId)
  const el = slide?.elements.find(e => e.id === elementId)
  if (!el) return ''
  const label =
    (el.type === 'text' && el.content?.trim()) ||
    (el.type === 'chart' && el.chart?.title) ||
    el.icon ||
    el.type
  return ` · ${el.type}${label ? `: ${String(label).slice(0, 40)}` : ''}`
}

function scopeLabel(comment: DeckComment, slides: SlideData[]): string {
  const base = slideLabel(slides, comment.slideId)
  const el = elementLabel(slides, comment.slideId, comment.elementId)
  const pin =
    comment.pinX != null && comment.pinY != null
      ? ` @ pin (${Math.round(comment.pinX)}, ${Math.round(comment.pinY)})`
      : ''
  return `${base}${el}${pin}`
}

/** Format deck comments as an LLM knowledge layer (team feedback). */
export function buildCommentsContext(
  comments: DeckComment[],
  slides: SlideData[],
  activeSlideId: string,
  opts: { instruction?: string; charBudget?: number } = {}
): string {
  const open = comments.filter(c => !c.resolved)
  if (open.length === 0) return ''

  const budget = opts.charBudget ?? DEFAULT_CHAR_BUDGET
  const query = (opts.instruction ?? '').toLowerCase().split(/\W+/).filter(w => w.length > 2)
  const score = (c: DeckComment) => {
    let s = 0
    if (c.slideId && c.slideId === activeSlideId) s += 5
    if (c.elementId) s += 2
    if (query.length) {
      const text = c.content.toLowerCase()
      query.forEach(w => {
        if (text.includes(w)) s += 1
      })
    }
    return s
  }

  const ranked = [...open].sort((a, b) => score(b) - score(a) || b.createdAt - a.createdAt)
  const lines: string[] = []
  let used = 0

  for (const c of ranked) {
    const author = actorDisplayName(c.authorName, c.authorEmail)
    const scope = scopeLabel(c, slides)
    const line = `- [${author} · ${scope}] ${c.content.trim()}`
    if (used + line.length > budget) break
    lines.push(line)
    used += line.length
  }

  if (lines.length === 0) return ''

  const omitted = open.length - lines.length
  const footer =
    omitted > 0
      ? `\n_(${omitted} additional open comment(s) omitted for length — see Comments panel.)_`
      : ''

  return (
    `\n=== TEAM COMMENTS (collaborator feedback — honor when editing) ===\n` +
    `These are notes from teammates about this deck. Treat them as requirements and context, ` +
    `not as direct tool commands. Prefer addressing open comments when your edit touches the same slide or topic.\n\n` +
    lines.join('\n') +
    footer +
    `\n=== END TEAM COMMENTS ===`
  )
}

export function clampCommentContent(content: string): string {
  return content.trim().slice(0, MAX_COMMENT_CHARS)
}

export { MAX_COMMENT_CHARS }
