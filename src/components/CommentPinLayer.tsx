'use client'

import { useRef } from 'react'
import { MessageSquare } from 'lucide-react'
import type { DeckComment } from '@/lib/types'

export type CommentPinMarker = Pick<
  DeckComment,
  'id' | 'pinX' | 'pinY' | 'resolved' | 'authorName'
>

interface Props {
  width: number
  height: number
  /** Pick a spot on the slide before writing a comment. */
  placementMode: boolean
  pins: CommentPinMarker[]
  pendingPin?: { pinX: number; pinY: number } | null
  onPlacePin: (x: number, y: number) => void
  onPinClick?: (commentId: string) => void
}

export default function CommentPinLayer({
  width,
  height,
  placementMode,
  pins,
  pendingPin,
  onPlacePin,
  onPinClick,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)

  const toLocal = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect()
    const x = Math.min(width, Math.max(0, ((clientX - rect.left) / rect.width) * width))
    const y = Math.min(height, Math.max(0, ((clientY - rect.top) / rect.height) * height))
    return { x, y }
  }

  const handlePlacementPointerDown = (e: React.PointerEvent) => {
    if (!placementMode || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const { x, y } = toLocal(e.clientX, e.clientY)
    onPlacePin(x, y)
  }

  const handlePinClick = (e: React.MouseEvent, id: string) => {
    if (placementMode) return
    e.stopPropagation()
    onPinClick?.(id)
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 31,
        pointerEvents: 'none',
        touchAction: placementMode ? 'none' : undefined,
      }}
    >
      {placementMode && (
        <rect
          width={width}
          height={height}
          fill="transparent"
          style={{ pointerEvents: 'auto', cursor: 'crosshair' }}
          onPointerDown={handlePlacementPointerDown}
        />
      )}
      {pins.map(p => {
        if (p.pinX == null || p.pinY == null) return null
        const label = (p.authorName || '?').charAt(0).toUpperCase()
        return (
          <g
            key={p.id}
            transform={`translate(${p.pinX}, ${p.pinY})`}
            onClick={e => handlePinClick(e, p.id)}
            style={{ cursor: 'pointer', pointerEvents: 'auto' }}
          >
            <circle
              r={14}
              fill={p.resolved ? 'rgba(100,116,139,0.85)' : 'rgba(45,212,191,0.95)'}
              stroke={p.resolved ? '#475569' : '#0f766e'}
              strokeWidth={2}
            />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fill="white"
              fontSize={11}
              fontWeight={700}
              pointerEvents="none"
            >
              {label}
            </text>
          </g>
        )
      })}

      {pendingPin && (
        <g transform={`translate(${pendingPin.pinX}, ${pendingPin.pinY})`} pointerEvents="none">
          <circle r={16} fill="none" stroke="#2dd4bf" strokeWidth={2} strokeDasharray="4 3" opacity={0.9} />
          <circle r={14} fill="rgba(45,212,191,0.95)" stroke="#0f766e" strokeWidth={2} />
          <text textAnchor="middle" dominantBaseline="central" fill="white" fontSize={16} fontWeight={700}>
            +
          </text>
        </g>
      )}
    </svg>
  )
}
