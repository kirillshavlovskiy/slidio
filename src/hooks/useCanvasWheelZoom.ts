'use client'

import { RefObject, useEffect, useRef } from 'react'

type Options = {
  zoom: number
  onZoomChange: (zoom: number) => void
  min: number
  max: number
  /** Fixed step for mouse wheel (line mode). Trackpad pinch uses proportional zoom. */
  step?: number
}

function clampZoom(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number(value.toFixed(3))))
}

/**
 * Canvas zoom via Mac trackpad pinch (ctrl+wheel), Safari gesture events,
 * or Ctrl/Cmd + scroll. Uses capture phase so the browser doesn't steal pinch
 * for page zoom before we can handle it.
 */
export function useCanvasWheelZoom(
  targetRef: RefObject<HTMLElement | null>,
  { zoom, onZoomChange, min, max, step = 0.1 }: Options
) {
  const zoomRef = useRef(zoom)
  const onZoomChangeRef = useRef(onZoomChange)

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  useEffect(() => {
    onZoomChangeRef.current = onZoomChange
  }, [onZoomChange])

  useEffect(() => {
    const el = targetRef.current
    if (!el) return

    const applyZoom = (next: number) => {
      onZoomChangeRef.current(clampZoom(next, min, max))
    }

    const onWheel = (e: WheelEvent) => {
      // Mac trackpad pinch synthesizes ctrl+wheel; mouse zoom uses ctrl/cmd+scroll.
      if (!e.ctrlKey && !e.metaKey) return

      e.preventDefault()
      e.stopPropagation()

      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
      if (delta === 0) return

      const cur = zoomRef.current

      // Pixel-mode deltas: trackpad pinch / smooth scroll → proportional zoom.
      if (e.deltaMode === WheelEvent.DOM_DELTA_PIXEL) {
        const factor = Math.exp(-delta * 0.002)
        applyZoom(cur * factor)
        return
      }

      applyZoom(cur + (delta < 0 ? step : -step))
    }

    let gestureBase = 1
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      gestureBase = zoomRef.current
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const scale = (e as Event & { scale?: number }).scale
      if (typeof scale === 'number' && scale > 0) {
        applyZoom(gestureBase * scale)
      }
    }
    const onGestureEnd = (e: Event) => {
      e.preventDefault()
    }

    const opts: AddEventListenerOptions = { passive: false, capture: true }
    el.addEventListener('wheel', onWheel, opts)
    el.addEventListener('gesturestart', onGestureStart, opts)
    el.addEventListener('gesturechange', onGestureChange, opts)
    el.addEventListener('gestureend', onGestureEnd, opts)

    return () => {
      el.removeEventListener('wheel', onWheel, opts)
      el.removeEventListener('gesturestart', onGestureStart, opts)
      el.removeEventListener('gesturechange', onGestureChange, opts)
      el.removeEventListener('gestureend', onGestureEnd, opts)
    }
  }, [targetRef, min, max, step])
}
