/** Shared routing heuristics (router API + client fallback). */

import {
  buildDeckBuildContinuationInstruction,
  isDeckBuildResumeTask,
  isNewDeckBuildRequest,
} from '../presentationScope'

/** Clarification option ids that mean "audit/fix layout" — always a CHANGE, never Q&A. */
export const LAYOUT_AUDIT_OPTION_IDS = new Set([
  'full-audit',
  'all_issues',
  'alignment',
  'text_collisions',
  'zebra_tables',
  'z_order',
])

/** User picked or typed a deck-wide layout audit / fix (not an information request). */
export const LAYOUT_AUDIT_CHANGE =
  /\b(full-?audit|audit\s+(all|every|the\s+whole|each|\d+)|layout\s+audit|fix\s+(the\s+)?layout|fix\s+(all\s+)?layout|fix\b[^.\n]{0,40}\blayout\b|\blayout\b[^.\n]{0,40}\bfix\b|align(ment)?\s+(and\s+)?(fix|spacing)|fix\s+(alignment|spacing|margins?|gutters?|layouts?|vertical\s+rhythm)|all\s+\d+\s+slides?)\b|\bOption\s+[\w-]+:\s*.*\b(audit|fix\s+all)\b/i

/** Single-slide / quick-action geometry fixes (tidy, overlaps, spacing) — not content edits. */
export const LAYOUT_GEOMETRY_CHANGE =
  /\b(tidy\s+(up\s+)?(the\s+)?layout|fix\s+(the\s+)?layout|fix\b[^.\n]{0,40}\blayout\b|\blayout\b[^.\n]{0,40}\bfix\b|fix\s+overlaps?(?:\s+and\s+(?:uneven\s+)?gaps?)?|overlapping\s+elements|uneven\s+gaps?|misalign(?:ed|ment)?|inconsistent\s+spacing(?:\/margins?)?|even\s+(out\s+)?spacing|within\s+(the\s+)?slide\s+bounds|clean[,\s]+balanced|grid\s+feels\s+even|icon[↔\s]*text\s+overlap|separat(?:e|ing)\s+icon|text[↔\s]*text\s+overlap|clipped\s+text|text\s+overflow|broken\s+layout|layout\s+(is\s+)?(broken|wrong|bad|off|messed)|(?:slide\s+)?(?:title\/header|title|header|headline).*(?:top|first|above|before|then)|(?:content|body|bullets?|columns?).*(?:below|under|after|beneath).*(?:title|header)|(?:title\/header|title|header).*(?:then|first).*(?:content|body|below|after|rest)|master\s+title|slide[\s-]wide\s+title)\b/i

/** User wants slide-wide title/header first, body content below — structure/layout only. */
export const SLIDE_STRUCTURE_LAYOUT =
  /\b(?:(?:slide\s+)?(?:title\/header|title|header|headline).*(?:top|first|above|at\s+the\s+top|then|before)|(?:content|body|bullets?|columns?).*(?:below|under|after|beneath).*(?:title\/header|title|header)|(?:title\/header|title|header).*(?:then|first).*(?:content|body|below|after|rest)|put\s+(?:the\s+)?(?:title\/header|title|header)|(?:title\/header|title|header)\s+first|master\s+title|slide[\s-]wide\s+title)\b/i

export function isSlideStructureLayoutRequest(instruction: string): boolean {
  return SLIDE_STRUCTURE_LAYOUT.test(instruction.trim())
}

export function isLayoutAuditChangeRequest(instruction: string): boolean {
  const t = instruction.trim()
  if (LAYOUT_AUDIT_CHANGE.test(t)) return true
  if (LAYOUT_GEOMETRY_CHANGE.test(t)) return true
  const optMatch = t.match(/^Option\s+([\w-]+):/i)
  if (optMatch && LAYOUT_AUDIT_OPTION_IDS.has(optMatch[1].toLowerCase())) return true
  return false
}

/** Simple visual styling — recolor/move/resize existing shapes, underlines, dividers. */
export const VISUAL_STYLE_CHANGE =
  /\b(underline|under\s*line|accent\s*bar|divider|recolor|re-?color|match(?:ing)?\s+(?:the\s+)?(?:icon|color)|same\s+(?:width|color|style)|delete\s+(?:the\s+)?(?:blue|divider)|(?:red|green|cyan|teal)\s+(?:line|bar|underline)|line\s+(?:under|below)|(?:left|right)\s+(?:side\s+)?(?:bar|underline)|visual\s+balance|mirror(?:ing)?\s+(?:the\s+)?(?:right|left|other))\b/i

export function isVisualStyleOnlyRequest(instruction: string): boolean {
  const t = instruction.trim()
  if (isKnowledgeBasedEditRequest(t)) return false
  return VISUAL_STYLE_CHANGE.test(t)
}

/** User wants slide title/header aligned with other deck slides — geometry only. */
export const TITLE_ALIGNMENT_FIX =
  /\b(?:align|fix|match|snap|move|need).*(?:title|header|headline|slide\s+title)|(?:title|header|headline|slide\s+title).*(?:align|misalign|not\s+align|wrong|off|match|same|consistent|with\s+(?:other|rest|deck)|to\s+(?:other|deck))|why.*(?:title|header).*(?:not\s+)?align|(?:other|rest\s+of\s+(?:the\s+)?deck).*(?:title|header|slide)|(?:i\s+)?asked.*(?:title|header).*(?:align|fix)|where\s+is\s+(?:the\s+)?align/i

export function isTitleAlignmentFixRequest(instruction: string): boolean {
  return TITLE_ALIGNMENT_FIX.test(instruction.trim())
}

/** Strip agent/router wrappers so the chat shows only what the user typed. */
export function stripUserFacingInstruction(text: string): string {
  const t = text.trim()

  // Phase 2/3 internal instructions must never be shown as user messages.
  const phase2 = t.match(/^\[PHASE 2[^\]]*\][^\n]*\n+([\s\S]+?)\n\nThe deck starts EMPTY/i)
  if (phase2) return 'Building deck from approved plan…'
  if (/^\[PHASE 2[^\]]*\]/i.test(t)) return 'Building deck from approved plan…'
  if (/^\[PHASE 3[^\]]*\]/i.test(t)) return 'Refining layout…'

  const answerOnly = t.match(/\[ANSWER ONLY[^\]]*\][\s\S]*?User question:\s*([\s\S]+)$/i)
  if (answerOnly) return answerOnly[1].trim()

  const titleAlign = t.match(/\[CHANGE — TITLE\/HEADER ALIGNMENT ONLY\]\n([\s\S]+?)(?:\n\nExecute|\n\n\d+\.|\n*$)/i)
  if (titleAlign) return titleAlign[1].trim().split('\n')[0].trim()

  const changeReq = t.match(/\[CHANGE REQUEST[^\]]*\]\n([\s\S]+?)(?:\n\n(?:Flow|Prior|Fix|User identified)|\n*$)/i)
  if (changeReq) return changeReq[1].trim().split('\n')[0].trim()

  const cont = t.match(/\[CONTINUE[^\]]*\][\s\S]*?Original task:\n([\s\S]+?)\n\nProgress/i)
  if (cont) return cont[1].trim().split('\n')[0].trim()

  const option = t.match(/^Option\s+[\w-]+:\s*(.+)$/i)
  if (option) return option[1].trim()

  return t
}

/** Layout/visual/title tasks — skip knowledge plan, graph dumps, claim review. */
export function isGeometryEditRequest(instruction: string): boolean {
  if (isKnowledgeBasedEditRequest(instruction)) return false
  return (
    isLayoutGeometryOnlyRequest(instruction) ||
    isTitleAlignmentFixRequest(instruction)
  )
}

export function formatTitleAlignmentDirective(instruction: string): string {
  return (
    `[CHANGE — TITLE/HEADER ALIGNMENT ONLY]\n${instruction}\n\n` +
    `Execute on canvas — do NOT answer with prose only.\n` +
    `1. get_slides for the target slide + 2 other content slides to find the deck-standard title y (usually y≈0.45in).\n` +
    `2. apply_changes ONCE: patch ONLY the title/header text element (e.g. header-main) — set y (and x if needed) to match other slides.\n` +
    `3. Do NOT add icons, fix bullets, underlines, or column layout unless the user explicitly asked for those.\n` +
    `4. render_slide → finish.\n`
  )
}

/** Layout pass that only moves/resizes — skip heavy knowledge graph + doc dumps. */
export function isLayoutGeometryOnlyRequest(instruction: string): boolean {
  return (
    (isLayoutAuditChangeRequest(instruction) || isVisualStyleOnlyRequest(instruction)) &&
    !isKnowledgeBasedEditRequest(instruction)
  )
}

export const LAYOUT_AUDIT_CHANGE_DIRECTIVE =
  '\n\n[CHANGE REQUEST — NOT Q&A:] Layout audit/fix task. You MUST call apply_changes with geometry patches (x, y, w, h, z-order, spacing, padLeft, style.fontSize when text clips) on every slide that needs fixes — including separating text↔text and icon/image from overlapping text, and fixing text-overflow where fontSize exceeds the box. Do NOT finish with a text-only deck inventory — the user must see changes on the canvas. Flow: get_slides (pass target slideIds) → apply_changes with ALL fixes in ONE call → render 1–2 slides to verify → finish with a SHORT summary of fixes applied.'

export const LAYOUT_CROSS_SLIDE_ICON_RULE =
  ' When fixing multiple slides: read ALL target slides first, then align title/header icons to the SAME x and y across slides (shared icon column). Keep icon↔text gaps consistent; narrow subtitle width or nudge text right so icons never overlap copy. Geometry only — do not bump fontSize to “fill” cells unless the user asked for typography changes.'

export function isDeckWideInstruction(instruction: string): boolean {
  return (
    /\b(the\s+)?(whole\s+)?(deck|presentation|slideshow|pitch\s+deck)\b|\b(all|every)\s+slides?\b|\ball\s+\d+\s+slides?/i.test(
      instruction.trim()
    )
  )
}

export function isDeckWideLayoutAudit(instruction: string): boolean {
  return isLayoutAuditChangeRequest(instruction) && isDeckWideInstruction(instruction)
}

export function withLayoutAuditDirective(instruction: string): string {
  if (!isLayoutAuditChangeRequest(instruction)) return instruction
  if (instruction.includes('[CHANGE REQUEST — NOT Q&A:]')) {
    if (!instruction.includes('SAME x and y across slides')) {
      return instruction + LAYOUT_CROSS_SLIDE_ICON_RULE
    }
    return instruction
  }
  return instruction + LAYOUT_AUDIT_CHANGE_DIRECTIVE + LAYOUT_CROSS_SLIDE_ICON_RULE
}

export const KNOWLEDGE_BASED_EDIT =
  /\b(research|claim|claims|metric|metrics|knowledge\s+base|hub\s+knowledge|our\s+(research|data|documents?|sources?|findings)|from\s+(the\s+)?(upload|document|hub|research|knowledge|sources?)|using\s+(our|the|uploaded|extracted)|integrate.*(claim|research|knowledge|document))\b/i

export function isKnowledgeBasedEditRequest(instruction: string): boolean {
  return KNOWLEDGE_BASED_EDIT.test(instruction.trim())
}

/** User wants to resume an interrupted multi-step agent run. */
const AGENT_CONTINUATION_EXACT =
  /^(continue|keep going|carry on|finish( it)?|go on|do the rest|pick up where you (left off|stopped)|resume)\.?$/i

export function isAgentContinuationMessage(text: string): boolean {
  const t = text.trim()
  if (AGENT_CONTINUATION_EXACT.test(t)) return true
  if (/^\s*continue\b/i.test(t) && /\b(deck|presentation|slides?|build(?:ing)?)\b/i.test(t)) {
    return true
  }
  return false
}

export type IncompleteAgentContext = {
  originalInstruction: string
  modifiedSlideIds: string[]
  /** Slides that actually need work — not the whole deck. */
  targetSlideIds: string[]
  lastAction: string
  wasLayoutAudit: boolean
  deckWide: boolean
  /** Phase 2 plan+knowledge system context — stored so "continue" can restore caching. */
  systemContext?: string
}

/** Build an explicit resume instruction so "continue" never triggers ask_user. */
export function buildAgentContinuationInstruction(
  ctx: IncompleteAgentContext,
  allSlideIds: string[]
): string {
  if (ctx.deckWide || isDeckBuildResumeTask(ctx.originalInstruction)) {
    return buildDeckBuildContinuationInstruction(
      ctx.originalInstruction,
      allSlideIds.length,
      allSlideIds
    )
  }

  const modified = new Set(ctx.modifiedSlideIds)
  const scopeTargets =
    ctx.targetSlideIds.length > 0
      ? ctx.targetSlideIds
      : ctx.wasLayoutAudit && ctx.modifiedSlideIds.length > 0
        ? ctx.modifiedSlideIds
        : allSlideIds
  const remaining = scopeTargets.filter(id => !modified.has(id))
  let block =
    `[CONTINUE — resume the incomplete task below. This is a CHANGE request, NOT a question. ` +
    `Do NOT call ask_user. Do NOT ask what to work on. Proceed immediately with tools. ` +
    `Do NOT restart from the beginning or re-audit completed slides.]\n\n` +
    `Original task:\n${ctx.originalInstruction}\n\n` +
    `Progress before stop:\n` +
    `- Work scope (${scopeTargets.length} slide(s) total): ${scopeTargets.join(', ')}\n` +
    `- Already patched (${ctx.modifiedSlideIds.length}) — LEAVE UNCHANGED: ${
      ctx.modifiedSlideIds.join(', ') || 'none'
    }\n`
  if (remaining.length > 0) {
    block += `- Remaining to fix (${remaining.length}) — EXECUTE ONLY THESE: ${remaining.join(', ')}\n`
    block +=
      `- Call get_slides with slideIds: [${remaining.map(id => `"${id}"`).join(', ')}] — NOT the full deck.\n`
  } else {
    block += `- All scoped slides patched — run render_slide, then finish ONLY if programmatic checks pass.\n`
    block +=
      `- If OVERLAP CHECK / text-overflow issues remain after your prior patch, call apply_changes again on those slides — ` +
      `do NOT treat "already patched" as done when overlaps or clipped text still exist.\n`
  }
  if (ctx.lastAction) block += `- Last completed action: ${ctx.lastAction}\n`
  block +=
    `\nYour job: apply_changes on remaining scoped slides (or re-patch if geometry checks still fail), ` +
    `render 1–2 to verify, finish. ` +
    `Do not re-read slide 1 or re-plan the whole deck.`
  if (ctx.wasLayoutAudit) {
    block += LAYOUT_AUDIT_CHANGE_DIRECTIVE + LAYOUT_CROSS_SLIDE_ICON_RULE
  }
  return block
}

/** Recover task context when the user says "continue" but the ref was lost (e.g. refresh). */
export function recoverIncompleteContextFromHistory(
  history: { role: string; content: string }[],
  modifiedSlideIds: string[] = []
): IncompleteAgentContext | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    if (m.role !== 'assistant') continue
    try {
      const r = JSON.parse(m.content)
      const q = typeof r?.question === 'string' ? r.question : ''
      if (!q.includes('[INCOMPLETE')) continue
      let original = ''
      for (let j = i - 1; j >= 0; j--) {
        if (history[j].role === 'user' && !isAgentContinuationMessage(history[j].content)) {
          original = history[j].content
          break
        }
      }
      if (!original) continue
      const wasLayoutAudit = isLayoutAuditChangeRequest(original)
      return {
        originalInstruction: original,
        modifiedSlideIds,
        targetSlideIds: [],
        lastAction: '',
        wasLayoutAudit,
        deckWide: isDeckWideLayoutAudit(original) || isDeckBuildResumeTask(original),
      }
    } catch {
      /* not JSON */
    }
  }
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== 'user') continue
    const content = history[i].content
    if (isAgentContinuationMessage(content)) continue
    if (isLayoutAuditChangeRequest(content) || content.length > 30) {
      return {
        originalInstruction: content,
        modifiedSlideIds,
        targetSlideIds: [],
        lastAction: '',
        wasLayoutAudit: isLayoutAuditChangeRequest(content),
        deckWide: isDeckWideLayoutAudit(content) || isDeckBuildResumeTask(content),
      }
    }
  }
  return null
}

/** Single-shot wrongly asked user to list claims that are already in the hub graph. */
export function isClarificationAskingForClaims(question: string): boolean {
  return /\b(which|what|share|provide|list|specify|once you provide|please (share|provide|list))\b/i.test(
    question
  ) && /\b(claim|metric|data point|research|knowledge base|figures?)\b/i.test(question)
}

/** Assistant asked the user to name slides / point to overlaps (layout fix thread). */
export function isAskingToIdentifySlides(text: string): boolean {
  const t = text.trim()
  return (
    /\b(point me to|identify|which slide|slide name|give me|tell me|please (give|confirm|provide))\b/i.test(
      t
    ) &&
    /\b(slide|overlap|icon|element id)\b/i.test(t)
  ) || /\bactual\s+\d+\s+slides?\s+with\s+real\s+overlaps?/i.test(t)
}

/** Parse 1-based slide positions from user text — ignores agent directive boilerplate. */
export function parseSlideNumbersFromText(text: string, maxSlides: number): number[] {
  // Layout directives contain ranges like "batch 2–4 slides" that must not become scope.
  const t = text.split(/\[(?:CHANGE REQUEST|CONTINUE|NEW REQUEST)/)[0].trim()
  const tLower = t.toLowerCase()

  const named = new Set<number>()
  if (
    /\b(first|cover|title|opening)\s+slide\b/.test(tLower) ||
    /\balign\s+first\b/.test(tLower) ||
    /\bthe\s+first\s+slide\b/.test(tLower)
  ) {
    named.add(1)
  }
  if (/\b(last|closing|final)\s+slide\b/.test(tLower) || /\bthe\s+last\s+slide\b/.test(tLower)) {
    named.add(maxSlides)
  }
  if (/\bfirst\s+and\s+last\b/.test(tLower)) {
    named.add(1)
    named.add(maxSlides)
  }
  if (named.size > 0) {
    return [...named].sort((a, b) => a - b)
  }

  const rangeMatch = t.match(
    /\bslides?\s+(\d{1,2})\s*(?:-|–|to)\s*(?:slides?\s+)?(\d{1,2})\b/i
  )
  if (rangeMatch) {
    const a = parseInt(rangeMatch[1], 10)
    const b = parseInt(rangeMatch[2], 10)
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter(
      n => n >= 1 && n <= maxSlides
    )
  }

  const withSlidePrefix = [...t.matchAll(/\bslide\s+(\d{1,2})\b/gi)]
    .map(m => parseInt(m[1], 10))
    .filter(n => n >= 1 && n <= maxSlides)
  if (withSlidePrefix.length) return [...new Set(withSlidePrefix)]

  const bareNums = [...t.matchAll(/\b(\d{1,2})\b/g)]
    .map(m => parseInt(m[1], 10))
    .filter(n => n >= 1 && n <= maxSlides)
  const uniqueBare = [...new Set(bareNums)]
  if (uniqueBare.length && isShortSlideTargetAnswer(text, uniqueBare)) return uniqueBare

  return []
}

/** Parse slide ids from "(id: slide-foo)" patterns in quick-action instructions. */
export function parseSlideIdsFromText(text: string): string[] {
  const t = text.split(/\[(?:CHANGE REQUEST|CONTINUE|NEW REQUEST)/)[0]
  return [
    ...new Set(
      [...t.matchAll(/\(id:\s*([a-zA-Z0-9_-]+)\)/g)].map(m => m[1]).filter(Boolean)
    ),
  ]
}

/** User message is mostly slide numbers — a follow-up answer, not a new question. */
export function isShortSlideTargetAnswer(text: string, slideNums: number[]): boolean {
  if (slideNums.length === 0) return false
  const withoutNums = text
    .trim()
    .replace(/\b(?:slide\s*)?\d{1,2}\b/gi, '')
    .replace(/\b(and|or|&,|to|-|–|only|just|slides?)\b/gi, '')
  return withoutNums.replace(/[^\w\s]/g, '').trim().length < 50
}

const LAYOUT_FIX_THREAD =
  /\b(overlap|icon|layout|align|spacing|audit|fix|revert|collision|zebra|geometry|margin)\b/i

/** Recent conversation is a layout/icon overlap fix — user answers should trigger edits. */
export function findRecentLayoutFixTask(
  history: { role: string; content: string }[]
): string | null {
  for (let i = history.length - 1; i >= 0 && i >= history.length - 12; i--) {
    const m = history[i]
    if (m.role === 'assistant') {
      try {
        const r = JSON.parse(m.content)
        const q = typeof r?.question === 'string' ? r.question : ''
        if (isAskingToIdentifySlides(q)) {
          for (let j = i - 1; j >= 0; j--) {
            if (history[j].role === 'user' && LAYOUT_FIX_THREAD.test(history[j].content)) {
              return history[j].content
            }
          }
          return 'Fix icon↔text overlaps on the slides the user names'
        }
        if (LAYOUT_FIX_THREAD.test(q) && /\b(overlap|icon|identify|revert)\b/i.test(q)) {
          return q.slice(0, 500)
        }
      } catch {
        if (LAYOUT_FIX_THREAD.test(m.content) && /\b(overlap|icon|identify)\b/i.test(m.content)) {
          return m.content.slice(0, 500)
        }
      }
    }
    if (m.role === 'user') {
      if (isLayoutAuditChangeRequest(m.content) || /\b(overlap|icon).*\b(fix|revert)\b/i.test(m.content)) {
        return m.content
      }
      if (/^Option\s+identify:/i.test(m.content)) {
        return m.content
      }
    }
  }
  return null
}

export function buildSlideTargetFixInstruction(
  slideNums: number[],
  slideIds: string[],
  priorTask: string
): string {
  const targets = slideNums
    .map((n, i) => `slide ${n} (${slideIds[i] ?? 'unknown'})`)
    .join(', ')
  return (
    `[CHANGE REQUEST — NOT Q&A:]\n` +
    `User identified target slides: ${targets}.\n` +
    `Prior layout task: ${priorTask}\n\n` +
    `Fix icon↔text overlaps on ONLY these ${slideNums.length} slide(s). ` +
    `Flow: get_slides with slideIds [${slideIds.map(id => `"${id}"`).join(', ')}] → ` +
    `apply_changes with geometry fixes → render 1–2 slides to verify → finish. ` +
    `Revert unnecessary icon size reductions on OTHER slides. ` +
    `Do NOT ask which slides or ask for confirmation — the user already said: ${slideNums.join(' and ')}.` +
    LAYOUT_AUDIT_CHANGE_DIRECTIVE
  )
}

/** Single-shot re-asked after the user already named slide numbers. */
export function isClarificationAskingToConfirmSlides(question: string): boolean {
  return (
    isAskingToIdentifySlides(question) ||
    /\b(confirm|are you asking|both slide|which of them|once I see)\b/i.test(question)
  )
}
