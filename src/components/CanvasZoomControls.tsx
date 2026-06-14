'use client'

import { Minus, Plus, RotateCcw } from 'lucide-react'

interface Props {
  zoom: number
  onZoomChange: (zoom: number) => void
  min?: number
  max?: number
  step?: number
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
}: Props) {
  const zoomIn = () => onZoomChange(clamp(Number((zoom + step).toFixed(2)), min, max))
  const zoomOut = () => onZoomChange(clamp(Number((zoom - step).toFixed(2)), min, max))
  const reset = () => onZoomChange(1)

  return (
    <div className="absolute bottom-3 right-3 z-20 flex items-center gap-0.5 rounded-lg border border-[#1e3a5f] bg-[#0d1b2a]/95 px-1 py-1 shadow-lg backdrop-blur-sm">
      <button
        type="button"
        onClick={zoomOut}
        disabled={zoom <= min}
        title="Zoom out (Ctrl + scroll)"
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
        title="Zoom in (Ctrl + scroll)"
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
  )
}
