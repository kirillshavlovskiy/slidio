'use client'
import { useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
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
  /** Reorder slides: move slide at fromIndex to toIndex. */
  onReorder?: (fromIndex: number, toIndex: number) => void
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
  onReorder,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const thumbScale = useFitScale(panelRef, { mode: 'width', padding: 36, maxScale: 0.4 })
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const draggable = !!onReorder

  return (
    <div ref={panelRef} className="px-3 py-3 w-full">
      <div className="px-1 pb-3">
        <p className="text-xs text-[#64748b] font-semibold tracking-widest">SLIDES</p>
        <p className="text-[10px] text-[#475569] mt-1 leading-snug">
          Ctrl/⌘ click · Shift click to multi-select · drag to reorder
        </p>
      </div>
      <div className="flex flex-col gap-3">
      {slides.map((slide, i) => {
        const isActive = activeSlideId === slide.id
        const isSelected = selectedSlideIds.includes(slide.id)
        const hasPending = pendingSlideIds.includes(slide.id)
        const isDeleted = deletedSlideIds.includes(slide.id)
        const label = slideLabel(slide, i)

        let buttonClass =
          'w-full text-left rounded-lg p-2.5 transition-all border group '
        if (isDeleted) {
          buttonClass += 'bg-[#2a0f0f] border-[#ef4444]/60 opacity-75'
        } else if (isActive) {
          buttonClass += 'bg-[#1e3a5f] border-[#60a5fa]'
        } else if (isSelected) {
          buttonClass += 'bg-[#152a45] border-[#60a5fa]/60'
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
            <button
            draggable={draggable}
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
              {hasPending && !isDeleted && (
                <span
                  className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-[#4ade80]"
                  title="Has proposed changes"
                />
              )}
            </div>

            <div className="relative overflow-hidden rounded-md bg-[#060d1a] w-full p-2 ring-1 ring-inset ring-black/30">
              <div className="flex justify-center">
                <SlideCanvas
                  slide={slide}
                  scale={thumbScale}
                  showShadow={false}
                  interactive={false}
                />
              </div>
            </div>
            </button>
          </div>
        )
      })}
      </div>
    </div>
  )
}
