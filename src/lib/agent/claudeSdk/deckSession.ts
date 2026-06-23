import { analyzeChanges } from '@/lib/changeDiagnostics'
import {
  findLayoutFixIssues,
  formatLayoutIssues,
  formatOverlapCheck,
  reviewLayoutChange,
} from '@/lib/layout'
import { applyChangesToSlides } from '@/lib/preview'
import { slimSlideJson } from '@/lib/presentationScope'
import type { Change, ClarificationQuestion, SlideData } from '@/lib/types'

export class AskUserPause extends Error {
  constructor(
    readonly payload: { intro?: string; questions: ClarificationQuestion[] }
  ) {
    super('ask_user')
    this.name = 'AskUserPause'
  }
}

export class DeckAgentSession {
  slides: SlideData[]
  readonly beforeRun: SlideData[]
  pendingChanges: Change[] = []
  summary = ''
  finished = false
  /** Number of apply_changes calls so far in this session. */
  applyCount = 0
  /** When true (deck builds), correction limit is not enforced. */
  deckBuild = false

  constructor(slides: SlideData[], opts?: { deckBuild?: boolean }) {
    this.deckBuild = opts?.deckBuild ?? false
    this.beforeRun = JSON.parse(JSON.stringify(slides)) as SlideData[]
    this.slides = JSON.parse(JSON.stringify(slides)) as SlideData[]
  }

  getSlide(slideId: string): string {
    const slide = this.slides.find(s => s.id === slideId)
    if (!slide) {
      return `Slide ${slideId} not found. Available: ${this.slides.map(s => s.id).join(', ')}`
    }
    return slimSlideJson([{ id: slide.id, bg: slide.bg, elements: slide.elements }])
  }

  getSlides(slideIds?: string[]): string {
    const picked = slideIds?.length
      ? this.slides.filter(s => slideIds.includes(s.id))
      : this.slides
    return slimSlideJson(picked.map(s => ({ id: s.id, bg: s.bg, elements: s.elements })))
  }

  renderSlide(slideId: string): string {
    const slide = this.slides.find(s => s.id === slideId)
    if (!slide) return `Could not render ${slideId} — slide not found.`
    const issues = findLayoutFixIssues(slide)
    const headline =
      slide.elements.find(e => e.type === 'text' && e.content?.trim())?.content?.slice(0, 60) ??
      '(no title text)'
    return (
      `Layout preview for ${slideId} (${slide.elements.length} elements): "${headline}".\n` +
      (issues.length
        ? `Open layout issues:\n${formatOverlapCheck(issues)}`
        : 'No overlaps, clipping, or misalignment detected by programmatic check.')
    )
  }

  applyChanges(rawChanges: Change[], summary?: string): string {
    if (!Array.isArray(rawChanges) || rawChanges.length === 0) {
      return 'apply_changes contained no changes. Provide a non-empty changes[] array.'
    }
    this.applyCount++
    const report = analyzeChanges(this.slides, rawChanges)
    const before = this.slides
    const next = applyChangesToSlides(before, rawChanges)
    this.slides = next
    this.pendingChanges = [...this.pendingChanges, ...rawChanges]
    const sum = summary || `${report.willApply} change(s)`
    this.summary = sum

    const { newIssues } = reviewLayoutChange(before, next)
    const touchedIds = new Set(rawChanges.map(c => c.slideId).filter(Boolean))
    const layoutOnTouched = [...touchedIds].flatMap(sid => {
      const s = next.find(sl => sl.id === sid)
      return s ? findLayoutFixIssues(s) : []
    })

    // Detect newly added slides so agent can verify all expected slides were created.
    const beforeIds = new Set(before.map(s => s.id))
    const addedSlideIds = next.map(s => s.id).filter(id => !beforeIds.has(id))
    const slideCountLine =
      addedSlideIds.length > 0
        ? `\nDeck now has ${next.length} slide(s). Newly added: [${addedSlideIds.join(', ')}]. If you planned more slides than this, your apply_changes was truncated — call apply_changes again for the remaining slides.`
        : `\nDeck now has ${next.length} slide(s).`

    // Enforce correction limit for non-deck-build sessions to prevent costly patch loops.
    const correctionWarning = !this.deckBuild && this.applyCount === 2
      ? '\n\n⚠️ CORRECTION LIMIT: this was your 2nd apply_changes. Do NOT call apply_changes again — call finish now. Remaining layout flags are minor false positives.'
      : !this.deckBuild && this.applyCount > 2
      ? '\n\n🛑 HARD STOP: you have already made 2 correction passes. Call finish immediately — further apply_changes calls are blocked from counting toward your summary.'
      : ''

    return (
      `Applied ${report.willApply} of ${report.total} change(s)${
        report.skipped
          ? ` (${report.skipped} skipped — verify those element ids exist on the slide)`
          : ''
      }.${slideCountLine}` +
      (newIssues.length
        ? `\n\nLAYOUT CHECK — this edit introduced ${newIssues.length} geometry issue(s):\n${formatLayoutIssues(newIssues)}`
        : '\n\nLAYOUT CHECK — no new overflow/overlap detected.') +
      (layoutOnTouched.length
        ? `\n\n${formatOverlapCheck(layoutOnTouched)}\n\nFix ALL issues above before finishing.`
        : '\n\nRe-render or finish when satisfied.') +
      correctionWarning
    )
  }

  finish(summary: string): string {
    this.finished = true
    this.summary = summary
    return summary
  }

  askUser(intro: string | undefined, questions: ClarificationQuestion[]): never {
    throw new AskUserPause({ intro, questions })
  }
}
