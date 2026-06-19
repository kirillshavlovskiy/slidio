'use client'

import { Check, X, CheckCheck, XCircle, ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  changeCount: number
  slideCount: number
  summary: string
  selectedAmendmentCount: number
  /** Pending changes on the slide currently open on the canvas. */
  activeSlideChangeCount: number
  /** 1-based index among slides that have pending changes (-1 if active slide has none). */
  activePendingSlideIndex: number
  source?: 'single' | 'agent'
  incomplete?: boolean
  onAcceptAll: () => void
  onDeclineAll: () => void
  onAcceptSelected: () => void
  onDeclineSelected: () => void
  onAcceptSlide: () => void
  onDeclineSlide: () => void
  onPrevPendingSlide: () => void
  onNextPendingSlide: () => void
}

export default function AmendmentsBar({
  changeCount,
  slideCount,
  summary,
  selectedAmendmentCount,
  activeSlideChangeCount,
  activePendingSlideIndex,
  source,
  incomplete,
  onAcceptAll,
  onDeclineAll,
  onAcceptSelected,
  onDeclineSelected,
  onAcceptSlide,
  onDeclineSlide,
  onPrevPendingSlide,
  onNextPendingSlide,
}: Props) {
  const sourceLabel = source === 'agent' ? 'Agent' : 'AI'
  const hasElementSelection = selectedAmendmentCount > 0
  const onActiveSlide = activeSlideChangeCount > 0
  const multiSlide = slideCount > 1

  return (
    <div className="flex-shrink-0 border-b border-[#1e3a5f] bg-[#0a1628]/95 backdrop-blur-sm px-4 py-2.5 z-20">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex-1 min-w-[200px]">
          <p className="text-xs font-semibold text-[#38bdf8] uppercase tracking-wide">
            {incomplete ? `${sourceLabel} · incomplete run` : `${sourceLabel} · review changes`}
          </p>
          <p className="text-sm text-[#e2e8f0] mt-0.5 line-clamp-2">
            {summary || `${changeCount} change${changeCount !== 1 ? 's' : ''} on ${slideCount} slide${slideCount !== 1 ? 's' : ''}`}
          </p>
          <p className="text-xs text-[#64748b] mt-0.5">
            {changeCount} amendment{changeCount !== 1 ? 's' : ''} · {slideCount} slide{slideCount !== 1 ? 's' : ''}
            {onActiveSlide
              ? ` · ${activeSlideChangeCount} on this slide`
              : multiSlide
                ? ' · switch slides in the left panel (green dot)'
                : ''}
            {hasElementSelection ? ` · ${selectedAmendmentCount} element(s) selected` : ''}
          </p>
          <p className="text-[11px] text-[#475569] mt-1 leading-snug">
            Each changed element shows a <span className="text-[#4ade80]">green dashed box</span> (new position) and{' '}
            <span className="text-[#fbbf24]">amber ghost</span> (previous position) with{' '}
            <span className="text-[#86efac]">✓</span> / <span className="text-[#fca5a5]">✗</span> buttons
            above it — click those to accept or decline that specific change.
          </p>
        </div>

        {multiSlide && (
          <div className="flex items-center gap-1 rounded-md border border-[#334155] bg-[#0f1c2e] p-0.5">
            <button
              type="button"
              onClick={onPrevPendingSlide}
              className="inline-flex items-center justify-center w-7 h-7 rounded text-[#94a3b8] hover:bg-[#1e293b] hover:text-[#e2e8f0] transition-colors"
              title="Previous slide with changes"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[11px] font-medium text-[#94a3b8] tabular-nums px-2 min-w-[5.5rem] text-center">
              {activePendingSlideIndex >= 0
                ? `Slide ${activePendingSlideIndex + 1} / ${slideCount}`
                : `${slideCount} slides`}
            </span>
            <button
              type="button"
              onClick={onNextPendingSlide}
              className="inline-flex items-center justify-center w-7 h-7 rounded text-[#94a3b8] hover:bg-[#1e293b] hover:text-[#e2e8f0] transition-colors"
              title="Next slide with changes"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {onActiveSlide && (
            <>
              <button
                type="button"
                onClick={onAcceptSlide}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#14532d] hover:bg-[#166534] text-[#86efac] border border-[#16a34a]/50 transition-colors"
                title="Accept every change on the current slide"
              >
                <Check className="w-3.5 h-3.5" />
                Accept slide
              </button>
              <button
                type="button"
                onClick={onDeclineSlide}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#450a0a] hover:bg-[#7f1d1d] text-[#fca5a5] border border-[#dc2626]/50 transition-colors"
                title="Decline every change on the current slide"
              >
                <X className="w-3.5 h-3.5" />
                Decline slide
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onAcceptSelected}
            disabled={!hasElementSelection}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#1e3a5f] hover:bg-[#234876] text-[#93c5fd] border border-[#3b82f6]/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#1e3a5f]"
            title={
              hasElementSelection
                ? `Accept ${selectedAmendmentCount} change(s) on selected element(s)`
                : 'Select changed elements on the canvas first'
            }
          >
            <Check className="w-3.5 h-3.5" />
            Accept selected
          </button>
          <button
            type="button"
            onClick={onDeclineSelected}
            disabled={!hasElementSelection}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#1e3a5f] hover:bg-[#234876] text-[#fca5a5] border border-[#475569] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#1e3a5f]"
            title={
              hasElementSelection
                ? `Decline ${selectedAmendmentCount} change(s) on selected element(s)`
                : 'Select changed elements on the canvas first'
            }
          >
            <X className="w-3.5 h-3.5" />
            Decline selected
          </button>
          <span className="w-px h-6 bg-[#334155] hidden sm:block" aria-hidden />
          <button
            type="button"
            onClick={onAcceptAll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-[#16a34a] hover:bg-[#15803d] text-white border border-[#22c55e]/60 transition-colors"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Accept all
          </button>
          <button
            type="button"
            onClick={onDeclineAll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#1e293b] hover:bg-[#334155] text-[#f87171] border border-[#475569] transition-colors"
          >
            <XCircle className="w-3.5 h-3.5" />
            Decline all
          </button>
        </div>
      </div>
    </div>
  )
}
