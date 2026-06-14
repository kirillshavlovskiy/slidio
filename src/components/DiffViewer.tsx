'use client'
import { useState } from 'react'
import { Send } from 'lucide-react'
import { Change, SlideData } from '@/lib/types'
import { ChangeDetail, getChangeDetails } from '@/lib/preview'

interface Props {
  summary: string
  changes: Change[]
  slides: SlideData[]
  activeSlideId: string
  highlightDiffOnCanvas: boolean
  onToggleHighlights: () => void
  onApply: () => void
  onDiscard: (reason?: string) => void
  onGoToSlide?: (slideId: string) => void
  // Refine the pending proposal in place (without applying it first).
  onRefine?: (text: string) => void
  isRefining?: boolean
  // Inline feedback from the last refine (AI question or confirmation).
  refineNote?: string | null
}

function formatHex(value: string): string {
  if (/^[0-9A-Fa-f]{6}$/.test(value)) return `#${value}`
  return value
}

export default function DiffViewer({
  summary,
  changes,
  slides,
  activeSlideId,
  highlightDiffOnCanvas,
  onToggleHighlights,
  onApply,
  onDiscard,
  onGoToSlide,
  onRefine,
  isRefining = false,
  refineNote,
}: Props) {
  const details = getChangeDetails(slides, changes)
  const otherSlides = Array.from(
    new Set(changes.map(c => c.slideId).filter(id => id !== activeSlideId))
  )
  const [refineText, setRefineText] = useState('')
  const [discarding, setDiscarding] = useState(false)
  const [discardReason, setDiscardReason] = useState('')

  const submitRefine = () => {
    const val = refineText.trim()
    if (!val || isRefining || !onRefine) return
    onRefine(val)
    setRefineText('')
  }

  return (
    <div className="bg-[#0f2a1a] border-t border-[#16a34a] max-h-64 overflow-y-auto">
      <div className="px-4 py-3 flex items-start gap-4 sticky top-0 bg-[#0f2a1a] border-b border-[#16a34a]/30 z-10">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-[#4ade80] font-semibold tracking-wide">PREVIEW — PROPOSED CHANGES</p>
          <p className="text-sm text-white mt-0.5">{summary}</p>
          <p className="text-xs text-[#64748b] mt-0.5">
            Compare Current vs Proposed above · {changes.length} change{changes.length !== 1 ? 's' : ''}
            {otherSlides.length > 0 && (
              <span>
                {' '}
                · also on slide{otherSlides.length !== 1 ? 's' : ''}{' '}
                {otherSlides.map(id => {
                  const idx = slides.findIndex(s => s.id === id)
                  return (
                    <button
                      key={id}
                      onClick={() => onGoToSlide?.(id)}
                      className="text-[#fbbf24] hover:text-[#fde68a] underline ml-1"
                    >
                      {idx + 1}
                    </button>
                  )
                })}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onToggleHighlights}
            className={`px-3 py-1.5 text-sm rounded border transition-colors ${
              highlightDiffOnCanvas
                ? 'bg-[#fbbf24]/15 border-[#fbbf24] text-[#fde68a]'
                : 'bg-[#1e293b] border-[#334155] text-[#94a3b8] hover:border-[#fbbf24]/50'
            }`}
          >
            {highlightDiffOnCanvas ? 'Hide highlights' : 'Show on canvas'}
          </button>
          <button
            onClick={() => setDiscarding(v => !v)}
            className="px-3 py-1.5 text-sm bg-[#1e293b] text-[#94a3b8] rounded hover:bg-[#334155]"
          >
            Discard
          </button>
          <button
            onClick={onApply}
            className="px-3 py-1.5 text-sm bg-[#16a34a] text-white rounded font-semibold hover:bg-[#15803d]"
          >
            Apply ✓
          </button>
        </div>
      </div>

      {/* Discard reason capture — optional, but it scopes decision memory so a
          single "no" doesn't become a blanket rule the AI over-applies later. */}
      {discarding && (
        <div className="px-4 pb-3 -mt-1 flex items-center gap-2">
          <input
            autoFocus
            value={discardReason}
            onChange={e => setDiscardReason(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onDiscard(discardReason)
              if (e.key === 'Escape') { setDiscarding(false); setDiscardReason('') }
            }}
            placeholder="Why? (optional — e.g. 'too bright', 'wrong slide') — helps the AI learn"
            className="flex-1 bg-[#0d1b2a] border border-[#334155] rounded px-2.5 py-1.5 text-xs text-white placeholder-[#475569] outline-none focus:border-[#f87171]"
          />
          <button
            onClick={() => onDiscard(discardReason)}
            className="px-3 py-1.5 text-xs bg-[#f87171] text-white rounded font-semibold hover:bg-[#ef4444] whitespace-nowrap"
          >
            Confirm discard
          </button>
        </div>
      )}

      <div className="px-4 py-3 space-y-3">
        {details.map((detail, i) => (
          <ChangeBlock key={i} detail={detail} isActiveSlide={detail.slideId === activeSlideId} />
        ))}
      </div>

      {onRefine && (
        <div className="px-4 py-3 border-t border-[#16a34a]/30 bg-[#0f2a1a] sticky bottom-0">
          <p className="text-[10px] text-[#64748b] mb-1.5">
            Adjust this proposal before applying — refines the preview, doesn&apos;t apply yet
          </p>
          {refineNote && (
            <p
              className={`text-[11px] mb-1.5 rounded px-2 py-1.5 leading-snug ${
                refineNote.startsWith('✓')
                  ? 'text-[#4ade80] bg-[#0a2417]'
                  : 'text-[#fbbf24] bg-[#2a1f0a]'
              }`}
            >
              {refineNote}
            </p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              rows={1}
              value={refineText}
              onChange={e => setRefineText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submitRefine()
                }
              }}
              placeholder="e.g. make the title bigger · move it down · use teal instead"
              disabled={isRefining}
              className="flex-1 resize-none bg-[#0a1f12] border border-[#16a34a]/40 rounded px-3 py-2 text-sm
                         text-white placeholder-[#475569] outline-none focus:border-[#4ade80]
                         disabled:opacity-50 transition-colors leading-snug max-h-32"
            />
            <button
              onClick={submitRefine}
              disabled={isRefining || !refineText.trim()}
              title="Refine proposal"
              className="flex-shrink-0 p-2 rounded bg-[#16a34a] text-white disabled:opacity-40
                         hover:bg-[#15803d] transition-colors"
            >
              {isRefining ? (
                <span className="flex items-center gap-1 px-1">
                  {[0, 150, 300].map(d => (
                    <span
                      key={d}
                      className="w-1 h-1 rounded-full bg-white animate-bounce"
                      style={{ animationDelay: `${d}ms` }}
                    />
                  ))}
                </span>
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ChangeBlock({ detail, isActiveSlide }: { detail: ChangeDetail; isActiveSlide: boolean }) {
  const isDelete = detail.op === 'delete' || detail.op === 'delete-slide'
  const isSlideDelete = detail.op === 'delete-slide'
  const isAdd = detail.op === 'add'

  return (
    <div
      className={`rounded-lg px-3 py-2.5 ${
        isDelete
          ? 'bg-[#2a0f0f] border border-[#ef4444]/40'
          : 'bg-[#0a1f12] border border-[#16a34a]/25'
      }`}
    >
      <p className={`text-xs font-semibold mb-2 ${isDelete ? 'text-[#fca5a5]' : 'text-[#86efac]'}`}>
        {isDelete && <span className="mr-1.5">DELETE</span>}
        {isAdd && <span className="mr-1.5 text-[#86efac]">ADD</span>}
        {isSlideDelete ? detail.label : detail.elementId ? detail.label : 'Slide background'}
        {!isActiveSlide && (
          <span className="text-[#fbbf24] font-normal ml-2">(other slide)</span>
        )}
      </p>
      <div className="space-y-1">
        {detail.fields.map((field, j) => (
          <div key={j} className="flex items-baseline gap-2 text-xs font-mono">
            {isDelete ? (
              <span className="text-[#f87171]">
                {isSlideDelete ? 'Slide will be removed from deck' : 'Element will be removed from slide'}
              </span>
            ) : (
              <>
                <span className="text-[#64748b] w-24 flex-shrink-0">{field.field}</span>
                <span className="text-[#f87171] line-through opacity-80">{formatHex(field.before)}</span>
                <span className="text-[#475569]">→</span>
                <span className="text-[#4ade80] font-semibold">{formatHex(field.after)}</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
