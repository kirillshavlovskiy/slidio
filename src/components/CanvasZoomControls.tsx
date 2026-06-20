'use client'

import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw } from 'lucide-react'

interface Props {
  zoom: number
  onZoomChange: (zoom: number) => void
  min?: number
  max?: number
  step?: number
  /** 0-based index of the active slide. Omit to hide slide navigation. */
  slideIndex?: number
  slideCount?: number
  onPrevSlide?: () => void
  onNextSlide?: () => void
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export default function CanvasZoomControls({
  zoom,
  onZoomChange,
  min = 0.25,
  max = 3,
  step = 0.1,
  slideIndex,
  slideCount = 0,
  onPrevSlide,
  onNextSlide,
}: Props) {
  const zoomIn = () => onZoomChange(clamp(Number((zoom + step).toFixed(2)), min, max))
  const zoomOut = () => onZoomChange(clamp(Number((zoom - step).toFixed(2)), min, max))
  const reset = () => onZoomChange(1)

  const showSlideNav =
    slideCount > 1 &&
    typeof slideIndex === 'number' &&
    slideIndex >= 0 &&
    onPrevSlide &&
    onNextSlide
  const atFirst = !showSlideNav || slideIndex <= 0
  const atLast = !showSlideNav || slideIndex >= slideCount - 1

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div className="pointer-events-auto absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg border border-[#1e3a5f] bg-[#0d1b2a]/95 px-1 py-1 shadow-lg backdrop-blur-sm">
      {showSlideNav && (
        <>
          <button
            type="button"
            onClick={onPrevSlide}
            disabled={atFirst}
            title="Previous slide"
            className="p-1.5 rounded text-[#94a3b8] hover:text-white hover:bg-[#1e3a5f] disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span
            className="min-w-[2.75rem] px-1 text-center text-[10px] font-semibold tabular-nums text-[#cbd5e1]"
            title="Current slide"
          >
            {slideIndex + 1}/{slideCount}
          </span>
          <button
            type="button"
            onClick={onNextSlide}
            disabled={atLast}
            title="Next slide"
            className="p-1.5 rounded text-[#94a3b8] hover:text-white hover:bg-[#1e3a5f] disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-5 bg-[#1e3a5f] mx-0.5" aria-hidden />
        </>
      )}
      <button
        type="button"
        onClick={zoomOut}
        disabled={zoom <= min}
        title="Zoom out (pinch or Ctrl + scroll)"
        className="p-1.5 rounded text-[#94a3b8] hover:text-white hover:bg-[#1e3a5f] disabled:opacity-30 transition-colors"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={reset}
        title="Reset zoom to fit"
        className="min-w-[3rem] px-1.5 py-1 text-[10px] font-semibold tabular-nums text-[#cbd5e1] hover:text-white hover:bg-[#1e3a5f] rounded transition-colors"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        onClick={zoomIn}
        disabled={zoom >= max}
        title="Zoom in (pinch or Ctrl + scroll)"
        className="p-1.5 rounded text-[#94a3b8] hover:text-white hover:bg-[#1e3a5f] disabled:opacity-30 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={reset}
        disabled={zoom === 1}
        title="Fit to pane"
        className="p-1.5 rounded text-[#64748b] hover:text-[#94a3b8] hover:bg-[#1e3a5f] disabled:opacity-30 transition-colors border-l border-[#1e3a5f] ml-0.5 pl-2"
      >
        <RotateCcw className="w-3 h-3" />
      </button>
      </div>
    </div>
  )
}
