'use client'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SlideData } from './types'
import { getIcon } from './icons'
import { elementTextHex } from './elementStyle'

// Render icons at high resolution so they stay crisp when placed/scaled in the deck.
const RASTER_PX = 512

/** Standalone SVG markup for a lucide icon with color + stroke baked in. */
function iconSvgMarkup(name: string | undefined, colorHex: string, strokeWidth: number): string {
  const Icon = getIcon(name)
  return renderToStaticMarkup(
    createElement(Icon, {
      color: colorHex,
      strokeWidth,
      width: RASTER_PX,
      height: RASTER_PX,
      // Ensures icons that use `currentColor` fills (e.g. small dots) resolve to
      // the icon color even when the SVG is rendered detached from the page.
      style: { color: colorHex },
    })
  )
}

/** Rasterize an SVG string to a PNG data URL via an offscreen canvas (browser-only). */
function svgToPng(svg: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = RASTER_PX
        canvas.height = RASTER_PX
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('no 2d context'))
        ctx.drawImage(img, 0, 0, RASTER_PX, RASTER_PX)
        resolve(canvas.toDataURL('image/png'))
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = () => reject(new Error('icon svg failed to load'))
    img.src = url
  })
}

/**
 * Return a deep copy of the deck with every `icon` element replaced by an
 * equivalent PNG `image` element. PNG is universally PowerPoint-compatible (unlike
 * embedded SVG), so this lets icons export identically to how they look on canvas
 * through the existing image pipeline (PPTX + PDF). Falls back to leaving the icon
 * untouched if rasterization isn't possible (e.g. called server-side).
 */
export async function rasterizeIconsInSlides(slides: SlideData[]): Promise<SlideData[]> {
  const out: SlideData[] = JSON.parse(JSON.stringify(slides))
  if (typeof document === 'undefined') return out // SSR / no canvas — nothing to do

  for (const slide of out) {
    for (let i = 0; i < slide.elements.length; i++) {
      const el = slide.elements[i]
      if (el.type !== 'icon') continue
      try {
        const colorHex = `#${elementTextHex(el)}`
        const strokeWidth = el.style?.iconStrokeWidth ?? 2
        const png = await svgToPng(iconSvgMarkup(el.icon, colorHex, strokeWidth))
        slide.elements[i] = {
          ...el,
          type: 'image',
          src: png,
          style: { ...el.style, objectFit: 'contain' },
        }
      } catch {
        /* keep the original element; export simply won't include this icon */
      }
    }
  }
  return out
}
