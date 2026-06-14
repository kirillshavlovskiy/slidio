'use client'

import { useRef, useState } from 'react'

export interface Stroke {
  color: string
  width: number
  points: { x: number; y: number }[]
}

interface Props {
  enabled: boolean
  color: string
  strokeWidth?: number
  strokes: Stroke[]
  onStrokesChange: (strokes: Stroke[]) => void
  width: number
  height: number
}

/**
 * Transparent freehand drawing overlay (Cursor-style pen).
 * Captures pointer events only when `enabled`. Renders strokes as smooth polylines.
 */
export default function AnnotationLayer({
  enabled,
  color,
  strokeWidth = 4,
  strokes,
  onStrokesChange,
  width,
  height,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [drawing, setDrawing] = useState(false)
  const currentRef = useRef<Stroke | null>(null)
  const [, force] = useState(0)

  const toLocal = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect()
    // Map screen coords back into the 960x720 viewBox space
    const x = ((e.clientX - rect.left) / rect.width) * width
    const y = ((e.clientY - rect.top) / rect.height) * height
    return { x, y }
  }

  const handleDown = (e: React.PointerEvent) => {
    if (!enabled) return
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const stroke: Stroke = { color, width: strokeWidth, points: [toLocal(e)] }
    currentRef.current = stroke
    setDrawing(true)
  }

  const handleMove = (e: React.PointerEvent) => {
    if (!enabled || !drawing || !currentRef.current) return
    currentRef.current.points.push(toLocal(e))
    force(n => n + 1)
  }

  const handleUp = () => {
    if (!enabled || !currentRef.current) return
    if (currentRef.current.points.length > 1) {
      onStrokesChange([...strokes, currentRef.current])
    }
    currentRef.current = null
    setDrawing(false)
  }

  const toPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  const live = currentRef.current

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerLeave={handleUp}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 30,
        pointerEvents: enabled ? 'auto' : 'none',
        cursor: enabled ? 'crosshair' : 'default',
        touchAction: 'none',
      }}
    >
      {strokes.map((s, i) => (
        <path
          key={i}
          d={toPath(s.points)}
          stroke={s.color}
          strokeWidth={s.width}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {live && live.points.length > 0 && (
        <path
          d={toPath(live.points)}
          stroke={live.color}
          strokeWidth={live.width}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}
