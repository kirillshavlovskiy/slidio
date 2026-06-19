import type { SlideData } from '@/lib/types'
import {
  findOverlapIssues,
  findSpacingIssues,
  findGeometryIssues,
  filterGeometryLayoutIssues,
  formatLayoutIssues,
  type LayoutIssue,
} from '@/lib/layout'
import {
  isDeckWideInstruction,
  isLayoutAuditChangeRequest,
  parseSlideIdsFromText,
  parseSlideNumbersFromText,
} from '@/lib/agent/routingHeuristics'
import { isNewDeckBuildRequest, isDesignSystemAlignmentRequest, isDeckWideDesignSystemRequest, parsePresentationScope } from '@/lib/presentationScope'

export type AgentWorkScope = {
  targetSlideIds: string[]
  alreadyDoneSlideIds: string[]
  remainingSlideIds: string[]
  issueBySlideId: Record<string, LayoutIssue[]>
  deckWide: boolean
  layoutAudit: boolean
  /** Design-system alignment: may read the whole deck to copy tokens from reference slides. */
  allowFullDeckRead?: boolean
  designSystemAlign?: boolean
}

export function describeSlidePosition(slides: SlideData[], slideId: string): string {
  const i = slides.findIndex(s => s.id === slideId)
  return i >= 0 ? `slide ${i + 1} (${slideId})` : slideId
}

export function scanSlidesForLayoutIssues(
  slides: SlideData[],
  candidateIds?: string[],
  geometryOnly?: boolean
): { slideIds: string[]; issuesBySlide: Map<string, LayoutIssue[]> } {
  const pool = candidateIds?.length
    ? slides.filter(s => candidateIds.includes(s.id))
    : slides
  const issuesBySlide = new Map<string, LayoutIssue[]>()
  for (const s of pool) {
    const issues = geometryOnly
      ? findGeometryIssues(s)
      : [...findOverlapIssues(s), ...findSpacingIssues(s)]
    if (issues.length) issuesBySlide.set(s.id, issues)
  }
  return { slideIds: Array.from(issuesBySlide.keys()), issuesBySlide }
}

export function resolveAgentWorkScope(input: {
  instruction: string
  slides: SlideData[]
  activeSlideId: string | null
  selectedSlideIds: string[]
  /** Authoritative scope from UI (quick actions / sidebar selection) — wins over text parsing. */
  forcedSlideIds?: string[]
  /** When true with forcedSlideIds, ignore slide numbers/ids parsed from instruction text. */
  uiAuthoritativeScope?: boolean
  deckWide?: boolean
  layoutAudit?: boolean
  /** Quick-action geometry pass — pre-scan and hints are overlap/overflow only. */
  geometryOnly?: boolean
  alreadyDoneSlideIds?: string[]
  priorTargetSlideIds?: string[]
}): AgentWorkScope {
  const layoutAudit =
    input.layoutAudit ?? isLayoutAuditChangeRequest(input.instruction)
  const geometryOnly = input.geometryOnly ?? false
  const designSystemAlign = isDesignSystemAlignmentRequest(input.instruction)
  const deckBuildWithScope =
    isNewDeckBuildRequest(input.instruction) && !!parsePresentationScope(input.instruction)
  let deckWide =
    input.deckWide ?? (layoutAudit && isDeckWideInstruction(input.instruction))
  if (deckBuildWithScope && !layoutAudit) deckWide = true
  const deckWideDesignSystem =
    designSystemAlign &&
    (input.deckWide === true || isDeckWideDesignSystemRequest(input.instruction))
  if (deckWideDesignSystem) deckWide = true
  const done = new Set(input.alreadyDoneSlideIds ?? [])

  const userInstruction = input.instruction.split(
    /\[(?:CHANGE REQUEST|CONTINUE|NEW REQUEST)/
  )[0]
  const skipTextScope = input.uiAuthoritativeScope && (input.forcedSlideIds?.length ?? 0) > 0
  const explicitNums = skipTextScope
    ? []
    : parseSlideNumbersFromText(userInstruction, input.slides.length)
  const explicitSlideIds = skipTextScope
    ? []
    : parseSlideIdsFromText(userInstruction).filter(id => input.slides.some(s => s.id === id))
  let targetSlideIds: string[] = []

  if (input.forcedSlideIds?.length) {
    targetSlideIds = input.forcedSlideIds.filter(id =>
      input.slides.some(s => s.id === id)
    )
  } else if (explicitNums.length > 0) {
    targetSlideIds = explicitNums
      .map(n => input.slides[n - 1]?.id)
      .filter((id): id is string => !!id)
  } else if (explicitSlideIds.length > 0) {
    targetSlideIds = explicitSlideIds
  } else if (!skipTextScope && input.priorTargetSlideIds?.length) {
    targetSlideIds = [...input.priorTargetSlideIds]
  } else if (input.selectedSlideIds.length > 1) {
    targetSlideIds = [...input.selectedSlideIds]
  } else if (input.selectedSlideIds.length === 1) {
    targetSlideIds = [input.selectedSlideIds[0]]
  } else if (input.activeSlideId) {
    targetSlideIds = [input.activeSlideId]
  } else if (layoutAudit && deckWide) {
    const { slideIds } = scanSlidesForLayoutIssues(input.slides, undefined, geometryOnly)
    targetSlideIds = slideIds
  } else if (deckWide) {
    targetSlideIds = input.slides.map(s => s.id)
  }

  if (designSystemAlign) {
    const dsNums = parseSlideNumbersFromText(userInstruction, input.slides.length)
    const dsSlideIds = parseSlideIdsFromText(userInstruction).filter(id =>
      input.slides.some(s => s.id === id)
    )
    if (dsNums.length > 0) {
      targetSlideIds = dsNums
        .map(n => input.slides[n - 1]?.id)
        .filter((id): id is string => !!id)
    } else if (dsSlideIds.length > 0) {
      targetSlideIds = dsSlideIds
    } else if (deckWideDesignSystem) {
      targetSlideIds = input.slides.map(s => s.id)
    }
  }

  // Deck build with confirmed depth: whole-deck scope (not just the active slide).
  if (deckBuildWithScope && !layoutAudit) {
    targetSlideIds = input.slides.map(s => s.id)
  }

  const issueBySlideId: Record<string, LayoutIssue[]> = {}
  if (layoutAudit && targetSlideIds.length) {
    const { issuesBySlide } = scanSlidesForLayoutIssues(
      input.slides,
      targetSlideIds,
      geometryOnly
    )
    for (const [id, issues] of issuesBySlide) {
      const filtered = geometryOnly ? filterGeometryLayoutIssues(issues) : issues
      if (filtered.length) issueBySlideId[id] = filtered.slice(0, 5)
    }
  } else if (layoutAudit && deckWide && !targetSlideIds.length) {
    const { slideIds, issuesBySlide } = scanSlidesForLayoutIssues(
      input.slides,
      undefined,
      geometryOnly
    )
    targetSlideIds = slideIds
    for (const [id, issues] of issuesBySlide) {
      const filtered = geometryOnly ? filterGeometryLayoutIssues(issues) : issues
      if (filtered.length) issueBySlideId[id] = filtered.slice(0, 5)
    }
  }

  const remainingSlideIds = targetSlideIds.filter(id => !done.has(id))

  return {
    targetSlideIds,
    alreadyDoneSlideIds: input.alreadyDoneSlideIds ?? [],
    remainingSlideIds,
    issueBySlideId,
    deckWide,
    layoutAudit,
    allowFullDeckRead: designSystemAlign && deckWideDesignSystem,
    designSystemAlign,
  }
}

export function formatAgentWorkScopeBlock(
  slides: SlideData[],
  scope: AgentWorkScope,
  isContinuation: boolean
): string {
  if (!scope.targetSlideIds.length && !scope.layoutAudit) return ''

  const lines: string[] = [
    '=== WORK SCOPE (authoritative — planning is DONE; execute only within this list) ===',
  ]

  if (scope.targetSlideIds.length) {
    lines.push(
      `Slides that need changes (${scope.targetSlideIds.length}): ${scope.targetSlideIds
        .map(id => describeSlidePosition(slides, id))
        .join(', ')}`
    )
  } else {
    lines.push('No layout issues detected in pre-scan — verify active/selected slides only.')
  }

  if (isContinuation && scope.alreadyDoneSlideIds.length) {
    lines.push(
      `COMPLETED — do NOT re-read or re-patch (unless a quick render verify): ${scope.alreadyDoneSlideIds
        .map(id => describeSlidePosition(slides, id))
        .join(', ')}`
    )
  }

  if (scope.remainingSlideIds.length) {
    lines.push(
      `EXECUTE NOW on remaining (${scope.remainingSlideIds.length}): ${scope.remainingSlideIds
        .map(id => describeSlidePosition(slides, id))
        .join(', ')}`
    )
    if (scope.allowFullDeckRead) {
      lines.push(
        'get_slides: omit slideIds to read the WHOLE deck (copy design tokens from reference slides). ' +
          `apply_changes ONLY on: ${scope.remainingSlideIds.map(id => describeSlidePosition(slides, id)).join(', ')}.`
      )
    } else {
      lines.push(
        `get_slides slideIds: [${scope.remainingSlideIds.map(id => `"${id}"`).join(', ')}] — NOT the full deck.`
      )
    }
  } else if (isContinuation) {
    lines.push('Scope complete — render 1–2 slides to verify, then finish.')
  }

  const issueEntries = Object.entries(scope.issueBySlideId).filter(([id]) =>
    scope.remainingSlideIds.length ? scope.remainingSlideIds.includes(id) : true
  )
  if (issueEntries.length) {
    lines.push('', 'Pre-detected issues (fix on canvas — do not re-inventory in prose):')
    for (const [slideId, issues] of issueEntries.slice(0, 14)) {
      const pos = describeSlidePosition(slides, slideId)
      lines.push(`- ${pos}: ${formatLayoutIssues(issues.slice(0, 3))}`)
    }
  }

  lines.push(
    '',
    'Execution rules:',
    scope.designSystemAlign
      ? '- Read reference slides via get_slides (whole deck). Patch ONLY slides listed above.'
      : '- This scope is FINAL. Do NOT restart from slide 1 or audit the whole deck.',
    scope.designSystemAlign
      ? '- STYLING ONLY: slidePatch.bg, style.fontFace, style.color, style.bg — do NOT move elements for margin/spacing.'
      : '- apply_changes ONLY for slides listed under EXECUTE NOW / remaining.',
    '- Do NOT patch slides marked COMPLETED.',
    '- When multiple slides are in scope: align title/header icons to the SAME x/y across them.',
    '- One planning pass was done client-side; your job is execution + verify.',
    '=== END WORK SCOPE ==='
  )
  return lines.join('\n')
}
