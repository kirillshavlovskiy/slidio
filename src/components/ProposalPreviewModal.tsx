'use client'
import { useEffect, useMemo, useState } from 'react'
import { X, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { Change, SlideData } from '@/lib/types'
import {
  applyChangesToSlides,
  getAffectedElementIds,
  getDeletedElementIds,
  getDeletedSlideIds,
  hasSlideLevelChange,
} from '@/lib/preview'
import SlideCanvas from '@/components/SlideCanvas'
import DiffViewer from '@/components/DiffViewer'

interface Props {
  slides: SlideData[]
  changes: Change[]
  summary: string
  onApply: () => void
  onDiscard: () => void
  onClose: () => void
  onRefine?: (text: string) => void
  isRefining?: boolean
  refineNote?: string | null
}

const BASE_W = 960
const BASE_H = 720
const SCALE = 0.46

/**
 * Full-screen overlay that presents a proposed AI change: the clean new design
 * side-by-side with the current slide, with toggleable change highlights, a
 * change list, refine box and Apply/Discard. Opened from the chat proposal
 * widget so the preview lives off the main editing canvas.
 */
export default function ProposalPreviewModal({
  slides,
  changes,
  summary,
  onApply,
  onDiscard,
  onClose,
  onRefine,
  isRefining,
  refineNote,
}: Props) {
  const previewSlides = useMemo(() => applyChangesToSlides(slides, changes), [slides, changes])
  const deletedSlideIds = useMemo(() => getDeletedSlideIds(changes), [changes])
  const changedIds = useMemo(() => {
    const ids = Array.from(new Set(changes.map(c => c.slideId).filter((x): x is string => !!x)))
    return ids.length ? ids : slides[0] ? [slides[0].id] : []
  }, [changes, slides])

  const [idx, setIdx] = useState(0)
  const [highlight, setHighlight] = useState(true)

  // Keep idx in range if the proposal changes (e.g. after a refine).
  useEffect(() => {
    if (idx > changedIds.length - 1) setIdx(0)
  }, [changedIds.length, idx])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const activeId = changedIds[Math.min(idx, changedIds.length - 1)] ?? changedIds[0]
  const current = slides.find(s => s.id === activeId)
  const proposed = previewSlides.find(s => s.id === activeId)
  const affected = getAffectedElementIds(changes, activeId)
  const deleted = getDeletedElementIds(changes, activeId)
  const slideBgChanged = hasSlideLevelChange(changes, activeId)
  const isSlideDelete = deletedSlideIds.includes(activeId)
  const slideIndex = slides.findIndex(s => s.id === activeId)

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#040912]/90 backdrop-blur-sm">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-4 px-5 py-3 border-b border-[#1e3a5f] bg-[#0d1b2a]">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-[#4ade80] tracking-widest">PROPOSED CHANGES</p>
          <p className="text-sm text-white truncate mt-0.5">{summary}</p>
        </div>
        {changedIds.length > 1 && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => setIdx(i => Math.max(0, i - 1))}
              disabled={idx === 0}
              className="p-1 rounded text-[#94a3b8] hover:text-white hover:bg-[#1e3a5f] disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-[#94a3b8] tabular-nums">
              slide {slideIndex >= 0 ? slideIndex + 1 : '?'} · {idx + 1}/{changedIds.length} changed
            </span>
            <button
              onClick={() => setIdx(i => Math.min(changedIds.length - 1, i + 1))}
              disabled={idx === changedIds.length - 1}
              className="p-1 rounded text-[#94a3b8] hover:text-white hover:bg-[#1e3a5f] disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
        <button
          onClick={onClose}
          title="Close preview (Esc)"
          className="flex-shrink-0 p-1.5 rounded text-[#94a3b8] hover:text-white hover:bg-[#1e3a5f] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Comparison */}
      <div className="flex-1 min-h-0 overflow-auto bg-[#060d1a]">
        <div className="flex min-h-full min-w-full items-center justify-center gap-10 p-8">
          <div className="flex flex-col items-center gap-3">
            <span className="text-xs font-bold text-[#fbbf24] tracking-widest uppercase">Current</span>
            <div
              className={`rounded-lg overflow-hidden shadow-2xl p-2 bg-[#060d1a]/50 ${
                highlight && slideBgChanged ? 'ring-2 ring-[#fbbf24]' : ''
              }`}
            >
              {current ? (
                <SlideCanvas
                  slide={current}
                  highlightedElementIds={affected}
                  deletedElementIds={deleted}
                  highlightColor="amber"
                  showDiffHighlights={highlight}
                  scale={SCALE}
                  interactive={false}
                />
              ) : (
                <NewSlidePlaceholder label="New slide" />
              )}
            </div>
          </div>

          <span className="text-3xl text-[#64748b] self-center">→</span>

          <div className="flex flex-col items-center gap-3">
            <span className="text-xs font-bold text-[#4ade80] tracking-widest uppercase">Proposed</span>
            <div
              className={`rounded-lg overflow-hidden shadow-2xl p-2 bg-[#060d1a]/50 ${
                isSlideDelete
                  ? 'ring-2 ring-[#ef4444] border border-[#ef4444]/40'
                  : highlight && slideBgChanged
                    ? 'ring-2 ring-[#4ade80]'
                    : ''
              }`}
              style={
                isSlideDelete
                  ? { width: BASE_W * SCALE + 16, height: BASE_H * SCALE + 16 }
                  : undefined
              }
            >
              {isSlideDelete ? (
                <div
                  className="flex flex-col items-center justify-center text-center px-4"
                  style={{ width: BASE_W * SCALE, height: BASE_H * SCALE }}
                >
                  <Trash2 className="w-8 h-8 text-[#f87171] mb-3 opacity-80" />
                  <p className="text-sm font-semibold text-[#fca5a5]">Slide will be deleted</p>
                  <p className="text-xs text-[#64748b] mt-1">Apply to remove it from the deck</p>
                </div>
              ) : proposed ? (
                <SlideCanvas
                  slide={proposed}
                  highlightedElementIds={affected}
                  highlightColor="green"
                  showDiffHighlights={highlight}
                  scale={SCALE}
                  interactive={false}
                />
              ) : (
                <NewSlidePlaceholder label="No preview" />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Change list + refine + actions */}
      <div className="flex-shrink-0">
        <DiffViewer
          summary={summary}
          changes={changes}
          slides={slides}
          activeSlideId={activeId}
          highlightDiffOnCanvas={highlight}
          onToggleHighlights={() => setHighlight(v => !v)}
          onApply={onApply}
          onDiscard={onDiscard}
          onGoToSlide={id => {
            const i = changedIds.indexOf(id)
            if (i >= 0) setIdx(i)
          }}
          onRefine={onRefine}
          isRefining={isRefining}
          refineNote={refineNote}
        />
      </div>
    </div>
  )
}

function NewSlidePlaceholder({ label }: { label: string }) {
  return (
    <div
      className="flex items-center justify-center text-xs text-[#64748b]"
      style={{ width: BASE_W * SCALE, height: BASE_H * SCALE }}
    >
      {label}
    </div>
  )
}
