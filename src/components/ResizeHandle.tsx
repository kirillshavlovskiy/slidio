'use client'

import { useCallback } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  side: 'left' | 'right'
  onResize: (delta: number) => void
  /** When provided, shows a collapse button that hides the adjacent panel. */
  onCollapse?: () => void
}

export default function ResizeHandle({ side, onResize, onCollapse }: Props) {
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      let lastX = e.clientX

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - lastX
        lastX = ev.clientX
        onResize(side === 'left' ? delta : -delta)
      }

      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [side, onResize]
  )

  // The collapse chevron points "into" the panel it hides (left panel → ◄,
  // right panel → ►).
  const CollapseIcon = side === 'left' ? ChevronLeft : ChevronRight

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Resize slide panel' : 'Resize chat panel'}
      onMouseDown={onMouseDown}
      className="group w-1.5 flex-shrink-0 cursor-col-resize relative z-10 bg-[#1e3a5f]/40 hover:bg-[#60a5fa]/40 active:bg-[#60a5fa]/60 transition-colors"
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
      {onCollapse && (
        <button
          type="button"
          aria-label={side === 'left' ? 'Collapse slide panel' : 'Collapse chat panel'}
          title={side === 'left' ? 'Collapse panel' : 'Collapse panel'}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation()
            onCollapse()
          }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex h-12 w-5 items-center justify-center rounded-md border border-[#1e3a5f] bg-[#0d1b2a] text-[#64748b] opacity-0 shadow-lg transition-opacity hover:text-[#93c5fd] group-hover:opacity-100"
        >
          <CollapseIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
