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

/** True when the user wants deck-wide styling (bg, fonts, colors) aligned to the design system. */
function isDeckWideDesignStylingRequest(instruction: string): boolean {
  const t = instruction.toLowerCase()
  if (
    /\b(background|backgrounds|font\s*colors?|typeface|typography|text\s*colors?|color\s*tokens?|palette|styling|visual\s+style|brand\s+colors?)\b/.test(
      t
    ) &&
    /\b(deck|presentation|whole|entire|all\s+slides?|every\s+slide|each\s+slide|main\s+design|design\s+narrativ|consistent|throughout|across)\b/.test(
      t
    )
  ) {
    return true
  }
  return (
    /\b(fix(?:ed)?\s+background|align.*colors?|match.*(?:slides?|deck)|same\s+(?:bg|background|fonts?|colors?))\b/.test(
      t
    ) || /\b(design\s+narrativ|main\s+design)\b/.test(t)
  )
}

/** True when the user wants to align/restyle/apply a loaded design system — NOT create a new deck. */
export function isDesignSystemAlignmentRequest(instruction: string): boolean {
  if (isDeckWideDesignStylingRequest(instruction)) return true
  const t = instruction.toLowerCase()
  if (/\bdesign\s+systems?\b/.test(t)) {
    return (
      /\b(align|match|apply|convert|restyle|sync|unify|consistent|same|elected|selected|like|list)\b/.test(
        t
      ) || /\b(first|other|existing)\s+slides?\b/.test(t)
    )
  }
  return (
    /\b(apply|convert|restyle|sync)\b/.test(t) &&
    /\b(design\s+system|loaded\s+design)\b/.test(t) &&
    /\b(deck|presentation|slides?)\b/.test(t)
  )
}

/** True when the user explicitly wants design system applied to the whole deck. */
export function isDeckWideDesignSystemRequest(instruction: string): boolean {
  const t = instruction.toLowerCase()
  if (
    /\b(only\s+these|this\s+slide|selected\s+elements?|scoped\s+slides?|do\s+not\s+touch\s+any\s+other\s+slides?)\b/.test(
      t
    )
  ) {
    return false
  }
  if (/\bapply to scoped slides only\b/.test(t)) return false
  if (/\(id:\s*[a-z0-9_-]+\)/i.test(instruction) && !/\b(entire|whole|all|every)\b/.test(t)) {
    return false
  }
  return (
    /\bconvert the entire\b/.test(t) ||
    /\b(entire|whole)\s+(presentation|deck)\b/.test(t) ||
    (/\b(all|every)\s+slides?\b/.test(t) && /\b(restyle|apply|convert)\b/.test(t)) ||
    /\bapply to all (existing )?slides\b/.test(t)
  )
}

/** True when the user is asking to create/populate a multi-slide deck from scratch or source material. */
export function isNewDeckBuildRequest(instruction: string): boolean {
  if (isDesignSystemAlignmentRequest(instruction)) return false
  const t = instruction.toLowerCase()
  // "design system" is styling — strip so "design" + "slides" does not look like deck creation.
  const normalized = t.replace(/\bdesign\s+systems?\b/g, ' ')

  if (
    /\b(build(?:ing)?|create|generate|make|populate|draft|develop|produce)\b/.test(normalized) &&
    /\b(deck|presentation|slides?|pitch)\b/.test(normalized)
  ) {
    return true
  }
  if (
    /\bdesign\b/.test(normalized) &&
    /\b(a|the|new|full|whole|entire|complete)\s+(deck|presentation)\b/.test(normalized)
  ) {
    return true
  }
  if (/\bcontinue\b.*\bbuild(?:ing)?\b.*\b(deck|presentation|slides?)\b/.test(normalized)) return true
  if (/\b(new|full|whole|entire|complete)\s+(deck|presentation)\b/.test(normalized)) return true
  if (/\b(deck|presentation)\s+from\b/.test(normalized)) return true
  if (/\bpopulate\b.*\bslides?\b/.test(normalized)) return true
  if (/\bfill\s+(in|out)\b.*\b(deck|slides?|presentation)\b/.test(normalized)) return true
  return false
}

/** Deck build with a confirmed depth (Light / Medium / In-depth). */
export function isDeckBuildResumeTask(instruction: string): boolean {
  return isNewDeckBuildRequest(instruction) && !!parsePresentationScope(instruction)
}

/** Parse light / medium / in-depth from the user's instruction or clarification answers. */
export function parsePresentationScope(text: string): PresentationScopeId | null {
  const t = text.toLowerCase()

  // Structured clarification form: "→ Light" / "→ Medium" / "→ In-depth"
  if (/→\s*in[- ]?depth\b/i.test(text)) return 'indepth'
  if (/→\s*medium\b/i.test(text)) return 'medium'
  if (/→\s*light\b/i.test(text)) return 'light'

  // Explicit slide counts in answers (e.g. "12–15 slide full deck") — highest priority.
  const range = t.match(/\b(\d{1,2})\s*[-–—to]+\s*(\d{1,2})\s*slides?\b/)
  if (range) {
    const hi = Math.max(parseInt(range[1], 10), parseInt(range[2], 10))
    if (hi >= 10) return 'indepth'
    if (hi >= 6) return 'medium'
    return 'light'
  }
  const singleCount = t.match(/\b(\d{1,2})\s*slides?\b/)
  if (singleCount) {
    const n = parseInt(singleCount[1], 10)
    if (n >= 10) return 'indepth'
    if (n >= 6) return 'medium'
    if (n <= 5) return 'light'
  }

  if (/\b(in[- ]?depth|indepth|comprehensive|detailed|full detail)\b/.test(t)) return 'indepth'
  if (/\b(medium|standard)\b/.test(t) && /\b(presentation|deck|scope|depth|detail|pitch)\b/.test(t)) {
    return 'medium'
  }

  // Strip design-system / theme phrases so "light design system" / "light theme" are not
  // confused with the Light depth scope.
  const withoutTheme = t
    .replace(/\blight\s+design\s+system\b/gi, '')
    .replace(/\bdark\s+design\s+system\b/gi, '')
    .replace(/\blight\s+theme\b/gi, '')
    .replace(/\bdark\s+theme\b/gi, '')
    .replace(/\blight\s+mode\b/gi, '')
    .replace(/\bdark\s+mode\b/gi, '')
    .replace(/\bdefault\s+design\s+system\b/gi, '')
    .replace(/\bdesign\s+system\b/gi, '')
  if (
    /\b(light|brief|short|quick|overview|minimal)\b/.test(withoutTheme) &&
    /\b(presentation|deck|scope|depth|detail)\b/.test(withoutTheme)
  ) {
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
    `Presentation scope: ${label} — when ADDING new slides, build at most ${max} total ` +
    `(hard cap ${MAX_DECK_SLIDES}). This cap does NOT block edits to slides that already exist ` +
    `(layout, alignment, text, colors). Prioritize the most important sections when creating new slides.`
  )
}

/** Resume a deck build after the user picks Light / Medium / In-depth. */
export function buildDeckBuildResumeInstruction(
  originalInstruction: string,
  depthAnswer: string,
  scope: PresentationScopeId,
  completedSlideIds: string[],
  designAlignment?: string
): string {
  const max = maxSlidesForScope(scope)
  const label = scope === 'indepth' ? 'In-depth' : scope.charAt(0).toUpperCase() + scope.slice(1)
  const remaining = Math.max(0, max - completedSlideIds.length)
  return (
    `[CONTINUE — deck build after presentation_depth. This is a CHANGE request. ` +
    `Do NOT call ask_user. Do NOT delete, replace, or rebuild slides that are already done.]\n\n` +
    `Original request:\n${originalInstruction}\n\n` +
    `User chose depth (${depthAnswer.trim()}):\n${formatPresentationScopeNote(scope)}\n\n` +
    (completedSlideIds.length
      ? `COMPLETED slides (${completedSlideIds.length}) — LEAVE UNCHANGED: ${completedSlideIds.join(', ')}\n\n`
      : '') +
    `Build ${remaining > 0 ? `up to ${remaining} more` : 'any remaining'} slide(s) for a ${label} presentation (≤${max} total). ` +
    `Add 2–3 NEW slides per apply_changes with full layouts. Use the knowledge graph and semantic edit plan. ` +
    `Skip micro-spacing polish until all section slides exist — then render 1–2 slides and finish.` +
    (designAlignment
      ? `\n\nApply the loaded design system consistently on every NEW slide:\n${designAlignment}`
      : '')
  )
}

/** Authoritative deck-build block injected into the agent intro (depth already chosen). */
export function formatDeckBuildExecuteBlock(
  scope: PresentationScopeId,
  currentSlideCount: number,
  completedSlideIds: string[] = [],
  designAlignment?: string
): string {
  const max = maxSlidesForScope(scope)
  const label = scope === 'indepth' ? 'In-depth' : scope.charAt(0).toUpperCase() + scope.slice(1)
  const lines = [
    `=== DECK BUILD (${label}) — depth confirmed; build slides now ===`,
    `Target: ≤${max} slides total (currently ${currentSlideCount}).`,
    `Workflow: get_slides once → apply_changes with 2–3 NEW slides per batch (cover + sections) → repeat until count reaches target → render 1–2 slides → finish.`,
    `Do NOT call ask_user for presentation_depth — the user already chose ${label}.`,
    `Do NOT spend turns on pixel-perfect spacing while slides are still missing.`,
    `Use knowledge graph + semantic edit plan as source of truth; mark unverified claims with *.`,
    designAlignment
      ? `DESIGN: Apply the loaded design system on EVERY new slide — same bg, fonts, and semantic colors throughout the deck.`
      : '',
  ]
  if (completedSlideIds.length) {
    lines.push(`LEAVE UNCHANGED: ${completedSlideIds.join(', ')}`)
  }
  if (designAlignment) lines.push('', designAlignment)
  lines.push('=== END DECK BUILD ===')
  return lines.join('\n')
}

/** Resume an interrupted deck build (edit ceiling, step limit, user says "continue building"). */
export function buildDeckBuildContinuationInstruction(
  originalInstruction: string,
  currentSlideCount: number,
  existingSlideIds: string[],
  designAlignment?: string
): string {
  const scope = parsePresentationScope(originalInstruction) ?? 'indepth'
  const max = maxSlidesForScope(scope)
  const remaining = Math.max(0, max - currentSlideCount)
  return (
    `[CONTINUE — deck build. CHANGE request. Do NOT call ask_user. ` +
    `Do NOT polish spacing on existing slides while the deck is still under the slide cap.]\n\n` +
    `Original task:\n${originalInstruction}\n\n` +
    `Deck status: ${currentSlideCount} slide(s) exist; target ≤${max} (${remaining} more to ADD).\n\n` +
    formatDeckBuildExecuteBlock(scope, currentSlideCount, existingSlideIds, designAlignment) +
    `\n\nPRIORITY: ADD ${remaining > 0 ? remaining : 'any remaining'} NEW section slide(s) (apply_changes op:"add"). ` +
    `LEAVE all ${existingSlideIds.length} existing slide(s) unchanged — do NOT re-edit or re-polish them. ` +
    `Batch 2–3 new slides per apply_changes, render 1–2 when near the cap, then finish.\n\n` +
    `⚠️ COST RULE — do NOT call get_slides() without slideIds. Reading all slides at once dumps ` +
    `${existingSlideIds.length * 2_800} + tokens into context and writes them to cache ` +
    `(~$0.10 penalty). You do not need to read the existing ${existingSlideIds.length} slides — ` +
    `they are COMPLETE. Start directly with apply_changes op:"add" for the new slides. ` +
    `If you must inspect an existing slide for style reference, call get_slide for ONE slide only.`
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

/**
 * Scope caps (Light/Medium/In-depth) limit NEW slide creation only — editing geometry
 * or content on slides that already exist is always allowed, even when the deck is
 * larger than the chosen build scope.
 */
export function wouldExceedScopeSlideLimit(
  slides: SlideData[],
  changes: Change[],
  scope: PresentationScopeId | null
): boolean {
  if (!changesAddSlides(changes)) return false
  const slideLimit = effectiveSlideLimit(scope)
  return projectDeckSlideCount(slides, changes) > slideLimit
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
