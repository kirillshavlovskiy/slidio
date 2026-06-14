'use client'

import { RefObject, useEffect, useState } from 'react'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '@/lib/slideDimensions'

export interface FitScaleOptions {
  mode?: 'width' | 'contain'
  padding?: number
  columns?: number
  gap?: number
  maxScale?: number
}

function computeScale(
  width: number,
  height: number,
  { mode = 'contain', padding = 0, columns = 1, gap = 0, maxScale = Infinity }: FitScaleOptions
) {
  const availW = Math.max(0, width - padding)
  const availH = Math.max(0, height - padding)
  const cols = Math.max(1, columns)
  const cellW = (availW - gap * (cols - 1)) / cols
  const scaleW = cellW / SLIDE_WIDTH
  const scaleH = availH / SLIDE_HEIGHT
  const next = mode === 'width' ? scaleW : Math.min(scaleW, scaleH)
  return Math.min(maxScale, Math.max(0.05, next))
}

export function useFitScale(
  containerRef: RefObject<HTMLElement | null>,
  options: FitScaleOptions = {}
) {
  const { mode, padding, columns, gap, maxScale } = options
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const update = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width === 0 && height === 0) return
      setScale(computeScale(width, height, options))
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    const raf = requestAnimationFrame(update)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [containerRef, mode, padding, columns, gap, maxScale])

  return scale
}
