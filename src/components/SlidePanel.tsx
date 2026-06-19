'use client'
import { useRef, useState } from 'react'
import { GripVertical, CopyCheck, Plus, Paperclip } from 'lucide-react'
import { SlideData } from '@/lib/types'
import { SlideSelectModifiers } from '@/lib/slideSelection'
import SlideCanvas from '@/components/SlideCanvas'
import { useFitScale } from '@/hooks/useFitScale'

interface Props {
  slides: SlideData[]
  activeSlideId: string
  selectedSlideIds: string[]
  pendingSlideIds?: string[]
  deletedSlideIds?: string[]
  onSelect: (id: string, modifiers: SlideSelectModifiers) => void
  /** Select every slide in the deck. */
  onSelectAll?: () => void
  /** Reorder slides: move slide at fromIndex to toIndex. */
  onReorder?: (fromIndex: number, toIndex: number) => void
  /** Append a new blank slide to the end of the deck. */
  onAddSlide?: () => void
  /** Slide ids that have at least one knowledge-graph element link. */
  linkedSlideIds?: Set<string>
  /** Element ids per slide linked to the knowledge graph. */
  linkedElementIdsBySlide?: Map<string, Set<string>>
  knowledgeLinkByElementId?: Map<string, { knowledgeName: string; knowledgeType: string }>
  showKnowledgePins?: boolean
}

function slideLabel(slide: SlideData, index: number): string {
  const headline = slide.elements.find(el => el.content?.trim())?.content?.trim()
  if (headline) {
    const oneLine = headline.replace(/\s+/g, ' ')
    return oneLine.length > 42 ? `${oneLine.slice(0, 42)}…` : oneLine
  }
  return `Slide ${index + 1}`
}

export default function SlidePanel({
  slides,
  activeSlideId,
  selectedSlideIds,
  pendingSlideIds = [],
  deletedSlideIds = [],
  onSelect,
  onSelectAll,
  onReorder,
  onAddSlide,
  linkedSlideIds,
  linkedElementIdsBySlide,
  knowledgeLinkByElementId,
  showKnowledgePins = false,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const thumbScale = useFitScale(panelRef, { mode: 'width', padding: 36, maxScale: 0.4 })
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [showLinkedOnly, setShowLinkedOnly] = useState(false)

  const draggable = !!onReorder
  const allSelected = slides.length > 0 && selectedSlideIds.length === slides.length
  const linkedCount = linkedSlideIds?.size ?? 0
  const visibleSlides = showLinkedOnly && linkedSlideIds?.size
    ? slides.filter(s => linkedSlideIds.has(s.id))
    : slides

  return (
    <div ref={panelRef} className="px-3 py-3 w-full">
      <div className="px-1 pb-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-[#64748b] font-semibold tracking-widest">SLIDES</p>
          {onSelectAll && slides.length > 1 && (
            <button
              type="button"
              onClick={onSelectAll}
              disabled={allSelected}
              className="inline-flex items-center gap-1 rounded-md border border-[#334155] bg-[#112236] px-2 py-1 text-[10px] font-semibold text-[#93c5fd] transition-colors hover:border-[#60a5fa]/60 hover:bg-[#152a45] disabled:cursor-default disabled:opacity-40 disabled:hover:border-[#334155] disabled:hover:bg-[#112236]"
              title="Select all slides"
            >
              <CopyCheck className="h-3 w-3" />
              {allSelected ? 'All selected' : 'Select all'}
            </button>
          )}
        </div>
        <p className="text-[10px] text-[#475569] mt-1 leading-snug">
          Ctrl/⌘ click · Shift click to multi-select · drag to reorder
          {linkedCount > 0 && (
            <span className="text-cyan-400/90"> · {linkedCount} slide{linkedCount === 1 ? '' : 's'} linked to KB</span>
          )}
        </p>
        {linkedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowLinkedOnly(v => !v)}
            className={`mt-2 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors ${
              showLinkedOnly
                ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-200'
                : 'border-[#334155] bg-[#112236] text-[#94a3b8] hover:border-cyan-500/40 hover:text-cyan-200'
            }`}
            title={showLinkedOnly ? 'Show all slides' : 'Show only slides with knowledge links'}
          >
            <Paperclip className="h-3 w-3" />
            {showLinkedOnly ? 'All slides' : 'Linked slides'}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-3">
      {visibleSlides.map(slide => {
        const i = slides.findIndex(s => s.id === slide.id)
        const isActive = activeSlideId === slide.id
        const isSelected = selectedSlideIds.includes(slide.id)
        const hasPending = pendingSlideIds.includes(slide.id)
        const isDeleted = deletedSlideIds.includes(slide.id)
        const hasKbLinks = showKnowledgePins && (linkedSlideIds?.has(slide.id) ?? false)
        const slideLinkedElements = linkedElementIdsBySlide?.get(slide.id)
        const label = slideLabel(slide, i)

        let buttonClass =
          'w-full text-left rounded-lg p-2.5 transition-all border group '
        if (isDeleted) {
          buttonClass += 'bg-[#2a0f0f] border-[#ef4444]/60 opacity-75'
        } else if (isActive) {
          buttonClass += hasKbLinks
            ? 'bg-[#1e3a5f] border-cyan-400'
            : 'bg-[#1e3a5f] border-[#60a5fa]'
        } else if (isSelected) {
          buttonClass += hasKbLinks
            ? 'bg-[#152a45] border-cyan-500/60'
            : 'bg-[#152a45] border-[#60a5fa]/60'
        } else if (hasKbLinks) {
          buttonClass += 'bg-[#112236] border-cyan-500/40 hover:border-cyan-500/60'
        } else {
          buttonClass += 'bg-[#112236] border-transparent hover:border-[#334155]'
        }

        const isDragging = dragIndex === i
        const isDropTarget = dragIndex !== null && overIndex === i && dragIndex !== i
        const indicatorAbove = isDropTarget && (dragIndex as number) > i
        const indicatorBelow = isDropTarget && (dragIndex as number) < i

        return (
          <div key={slide.id} className="relative">
            {indicatorAbove && (
              <div className="absolute -top-1.5 left-0 right-0 h-0.5 rounded-full bg-[#60a5fa]" />
            )}
            {indicatorBelow && (
              <div className="absolute -bottom-1.5 left-0 right-0 h-0.5 rounded-full bg-[#60a5fa]" />
            )}
            {isSelected && !isDeleted && onSelectAll && slides.length > 1 && !allSelected && (
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation()
                  onSelectAll()
                }}
                className="absolute right-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded-md border border-[#60a5fa]/60 bg-[#152a45] px-1.5 py-0.5 text-[9px] font-semibold text-[#93c5fd] shadow-sm transition-colors hover:bg-[#1e3a5f]"
                title="Select all slides"
              >
                <CopyCheck className="h-2.5 w-2.5" />
                All
              </button>
            )}
            <button
            draggable={draggable && !showLinkedOnly}
            onDragStart={
              draggable
                ? e => {
                    setDragIndex(i)
                    e.dataTransfer.effectAllowed = 'move'
                  }
                : undefined
            }
            onDragOver={
              draggable
                ? e => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (overIndex !== i) setOverIndex(i)
                  }
                : undefined
            }
            onDrop={
              draggable
                ? e => {
                    e.preventDefault()
                    if (dragIndex !== null && dragIndex !== i) onReorder?.(dragIndex, i)
                    setDragIndex(null)
                    setOverIndex(null)
                  }
                : undefined
            }
            onDragEnd={
              draggable
                ? () => {
                    setDragIndex(null)
                    setOverIndex(null)
                  }
                : undefined
            }
            onClick={e =>
              onSelect(slide.id, {
                shift: e.shiftKey,
                ctrl: e.ctrlKey || e.metaKey,
              })
            }
            className={`${buttonClass} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${
              isDragging ? 'opacity-40' : ''
            }`}
            title={label}
          >
            <div className="flex items-center justify-between gap-1 px-0.5 mb-1.5">
              {draggable && (
                <GripVertical className="w-3 h-3 flex-shrink-0 text-[#475569] group-hover:text-[#64748b]" />
              )}
              <span
                className={`text-[10px] font-semibold tabular-nums ${
                  isActive || isSelected ? 'text-[#93c5fd]' : 'text-[#64748b]'
                }`}
              >
                {i + 1}
              </span>
              <span
                className={`flex-1 truncate text-[10px] ${
                  isActive || isSelected ? 'text-[#e2e8f0]' : 'text-[#64748b]'
                }`}
              >
                {label}
              </span>
              {isDeleted && (
                <span
                  className="flex-shrink-0 text-[9px] font-bold text-[#f87171] uppercase"
                  title="Will be deleted"
                >
                  Del
                </span>
              )}
              {hasKbLinks && !isDeleted && (
                <span
                  className="flex-shrink-0 inline-flex items-center justify-center w-4 h-4 rounded bg-cyan-500/20 text-cyan-300"
                  title="Has knowledge graph links"
                >
                  <Paperclip className="w-2.5 h-2.5" />
                </span>
              )}
              {hasPending && !isDeleted && (
                <span
                  className="flex-shrink-0 text-[9px] font-bold text-[#4ade80] uppercase tracking-wide"
                  title="Has proposed changes"
                >
                  Edits
                </span>
              )}
            </div>

            <div className="relative overflow-hidden rounded-md bg-[#060d1a] w-full p-2 ring-1 ring-inset ring-black/30">
              <div className="flex justify-center">
                <SlideCanvas
                  slide={slide}
                  scale={thumbScale}
                  showShadow={false}
                  interactive={false}
                  knowledgeLinkedElementIds={slideLinkedElements}
                  knowledgeLinkByElementId={knowledgeLinkByElementId}
                />
              </div>
            </div>
            </button>
          </div>
        )
      })}
      {onAddSlide && (
        <button
          type="button"
          onClick={onAddSlide}
          title="Add new slide"
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#334155] py-3 text-[11px] font-semibold text-[#64748b] transition-colors hover:border-[#60a5fa]/60 hover:bg-[#112236] hover:text-[#93c5fd]"
        >
          <Plus className="h-3.5 w-3.5" />
          Add slide
        </button>
      )}
      </div>
    </div>
  )
}
