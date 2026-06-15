import { SlideData, SlideGradient } from '@/lib/types'

const hash = (h: string) => `#${String(h ?? '').replace('#', '')}`

/** Build a CSS gradient string from a SlideGradient. */
export function gradientCss(g: SlideGradient): string {
  const stops = [g.from, g.via, g.to].filter((s): s is string => Boolean(s)).map(hash)
  if (stops.length < 2) return ''
  if ((g.type ?? 'linear') === 'radial') {
    return `radial-gradient(circle at 50% 35%, ${stops.join(', ')})`
  }
  const angle = g.angle ?? 135
  return `linear-gradient(${angle}deg, ${stops.join(', ')})`
}

/** Inline style props for a slide background (solid color + optional gradient). */
export function slideBackgroundStyle(
  slide: Pick<SlideData, 'bg' | 'bgGradient'>
): { backgroundColor: string; backgroundImage?: string } {
  const backgroundColor = hash(slide.bg)
  if (slide.bgGradient) {
    const img = gradientCss(slide.bgGradient)
    if (img) return { backgroundColor, backgroundImage: img }
  }
  return { backgroundColor }
}

/** Curated gradient presets used by the toolbar + design panel. */
export const GRADIENT_PRESETS: SlideGradient[] = [
  { type: 'linear', angle: 135, from: '0EA5E9', to: '6366F1' },
  { type: 'linear', angle: 135, from: '8B5CF6', to: 'EC4899' },
  { type: 'linear', angle: 160, from: '0F172A', to: '1E3A8A' },
  { type: 'linear', angle: 135, from: 'F59E0B', to: 'EF4444' },
  { type: 'linear', angle: 135, from: '10B981', to: '0EA5E9' },
  { type: 'linear', angle: 160, from: '111827', to: '374151' },
  { type: 'linear', angle: 135, from: 'FB7185', to: 'FB923C' },
  { type: 'radial', from: '1E293B', to: '0B1220' },
]
