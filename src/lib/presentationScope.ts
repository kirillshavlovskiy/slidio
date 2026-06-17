import type { Change, ClarificationQuestion, SlideData } from './types'
import { applyChangesToSlides } from './preview'

/** Hard ceiling — no deck may exceed this many slides regardless of scope. */
export const MAX_DECK_SLIDES = 20

export type PresentationScopeId = 'light' | 'medium' | 'indepth'

export const PRESENTATION_SCOPE_LIMITS: Record<PresentationScopeId, number> = {
  light: 5,
  medium: 10,
  indepth: 15,
}

export const PRESENTATION_DEPTH_QUESTION: ClarificationQuestion = {
  id: 'presentation_depth',
  question: 'How detailed should this presentation be?',
  options: [
    {
      id: 'light',
      label: 'Light',
      description: 'Quick overview — up to 5 slides (cover, 2–3 key points, closing).',
    },
    {
      id: 'medium',
      label: 'Medium',
      description: 'Standard pitch — up to 10 slides with the core narrative.',
    },
    {
      id: 'indepth',
      label: 'In-depth',
      description: 'Comprehensive — up to 15 slides with detailed sections.',
    },
  ],
}

/** True when the user is asking to create/populate a multi-slide deck from scratch or source material. */
export function isNewDeckBuildRequest(instruction: string): boolean {
  const t = instruction.toLowerCase()
  if (
    /\b(build|create|generate|make|populate|draft|design|develop|produce)\b/.test(t) &&
    /\b(deck|presentation|slides?|pitch)\b/.test(t)
  ) {
    return true
  }
  if (/\b(new|full|whole|entire|complete)\s+(deck|presentation)\b/.test(t)) return true
  if (/\b(deck|presentation)\s+from\b/.test(t)) return true
  if (/\bpopulate\b.*\bslides?\b/.test(t)) return true
  if (/\bfill\s+(in|out)\b.*\b(deck|slides?|presentation)\b/.test(t)) return true
  return false
}

/** Parse light / medium / in-depth from the user's instruction or clarification answers. */
export function parsePresentationScope(text: string): PresentationScopeId | null {
  const t = text.toLowerCase()
  // Structured clarification form: "→ Light" / "→ Medium" / "→ In-depth"
  if (/→\s*in[- ]?depth\b/i.test(text)) return 'indepth'
  if (/→\s*medium\b/i.test(text)) return 'medium'
  if (/→\s*light\b/i.test(text)) return 'light'
  if (/\b(in[- ]?depth|indepth|comprehensive|detailed|full detail)\b/.test(t)) return 'indepth'
  if (/\b(medium|standard)\b/.test(t) && /\b(presentation|deck|scope|depth|detail|pitch)\b/.test(t)) {
    return 'medium'
  }
  if (/\b(light|brief|short|quick|overview|minimal)\b/.test(t) && /\b(presentation|deck|scope|depth|detail)\b/.test(t)) {
    return 'light'
  }
  if (/\boption\s+indepth\b|\bid:\s*indepth\b|\bpresentation_depth.*in[- ]?depth\b/.test(t)) {
    return 'indepth'
  }
  if (/\boption\s+medium\b|\bid:\s*medium\b|\bpresentation_depth.*medium\b/.test(t)) return 'medium'
  if (/\boption\s+light\b|\bid:\s*light\b|\bpresentation_depth.*light\b/.test(t)) return 'light'
  return null
}

export function maxSlidesForScope(scope: PresentationScopeId): number {
  return PRESENTATION_SCOPE_LIMITS[scope]
}

export function effectiveSlideLimit(scope: PresentationScopeId | null): number {
  if (scope) return Math.min(maxSlidesForScope(scope), MAX_DECK_SLIDES)
  return MAX_DECK_SLIDES
}

export function formatPresentationScopeNote(scope: PresentationScopeId): string {
  const max = maxSlidesForScope(scope)
  const label = scope === 'indepth' ? 'In-depth' : scope.charAt(0).toUpperCase() + scope.slice(1)
  return (
    `Presentation scope: ${label} — build at most ${max} slides total in this deck ` +
    `(hard cap ${MAX_DECK_SLIDES}). Prioritize the most important sections; do not exceed the limit.`
  )
}

export function formatScopeGateNote(): string {
  return (
    `MANDATORY — before adding or populating slides for this new presentation, call ask_user FIRST ` +
    `with question id "presentation_depth" and options Light (≤${PRESENTATION_SCOPE_LIMITS.light} slides), ` +
    `Medium (≤${PRESENTATION_SCOPE_LIMITS.medium}), In-depth (≤${PRESENTATION_SCOPE_LIMITS.indepth}). ` +
    `Do NOT call apply_changes to add slides until the user picks a depth (unless they already stated light/medium/in-depth in their message).`
  )
}

/** Project deck size after applying changes (without mutating live state). */
export function projectDeckSlideCount(slides: SlideData[], changes: Change[]): number {
  return applyChangesToSlides(slides, changes).length
}

export function countNewSlidesInChanges(changes: Change[], existingSlideIds: Set<string>): number {
  return changes.filter(c => c.op === 'add' && c.slide?.id && !existingSlideIds.has(c.slide.id)).length
}

export function changesAddSlides(changes: Change[]): boolean {
  return changes.some(c => c.op === 'add' && c.slide)
}

const KNOWLEDGE_BLOCK = /\n=== KNOWLEDGE CONTEXT ===[\s\S]*?=== END KNOWLEDGE CONTEXT ===\n?/g
const RECENT_CONVERSATION = /\nRECENT CONVERSATION[\s\S]*?(?=\nDeck overview)/g
const TEMPLATE_BLOCK = /\nReference template styling:\n[\s\S]*?(?=\n\nIf the instruction|\nIf the instruction|$)/g
const MEDIA_BLOCK = /\nMEDIA LIBRARY[\s\S]*?(?=\n\nReference template styling:|\nIf the instruction|$)/g

/**
 * After the first agent step, drop heavy knowledge/template/media blocks from the intro
 * so they are not re-sent on every subsequent turn (saves tens of thousands of tokens).
 */
export function compressAgentIntro(
  fullIntro: string,
  instruction: string,
  extras?: { scopeNote?: string }
): string {
  let out = fullIntro
    .replace(KNOWLEDGE_BLOCK, '\n')
    .replace(RECENT_CONVERSATION, '\n')
    .replace(TEMPLATE_BLOCK, '\n')
    .replace(MEDIA_BLOCK, '\n')
    .replace(/\nFollow this knowledge & design system as the source of truth:\n+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')

  const compressedNote =
    '[Context note: full knowledge docs, templates and media lists were provided on the first turn. ' +
    'Use get_slide/get_slides for current slide data and prior tool results — do not assume missing context.]'

  const scopeLine = extras?.scopeNote ? `\n${extras.scopeNote}\n` : ''

  return (
    `User instruction: "${instruction}"\n\n` +
    `${compressedNote}${scopeLine}\n` +
    out.replace(/^User instruction:[\s\S]*?\n\n/, '')
  ).trim()
}

/** Slim slide JSON for tool results on older turns (server-side trim helper). */
export function slimSlideJson(slides: unknown): string {
  if (!Array.isArray(slides)) return String(slides).slice(0, 1200)
  type SlimEl = { id?: string; type?: string; content?: string; x?: number; y?: number; w?: number; h?: number }
  const slim = slides.map((raw: unknown) => {
    const s = raw as { id?: string; bg?: string; elements?: unknown[] }
    const elements = Array.isArray(s.elements) ? (s.elements as SlimEl[]) : []
    return {
      id: s.id,
      bg: s.bg,
      elementCount: elements.length,
      elements: elements.map(e => ({
        id: e.id,
        type: e.type,
        content: typeof e.content === 'string' ? e.content.slice(0, 80) : undefined,
        x: e.x,
        y: e.y,
        w: e.w,
        h: e.h,
      })),
    }
  })
  const json = JSON.stringify(slim)
  return json.length > 4000 ? json.slice(0, 4000) + ' …[truncated]' : json
}
