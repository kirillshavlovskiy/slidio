import JSZip from 'jszip'

/**
 * PowerPoint colors are rarely literal hex values. Most decks reference the
 * theme via <a:schemeClr val="accent1"/> (optionally adjusted with luminance /
 * shade / tint modifiers), and the slide master remaps logical slots (bg1/tx1)
 * onto theme slots (lt1/dk1) through its <p:clrMap>. This module resolves any
 * color element down to a concrete RRGGBB hex so imported slides keep the
 * original document's palette instead of falling back to black/white.
 */
export interface ColorContext {
  /** Theme slot (dk1, lt1, dk2, lt2, accent1–6, hlink, folHlink) → hex. */
  theme: Record<string, string>
  /** Master color map: bg1/tx1/bg2/tx2/accent…/hlink → theme slot. */
  clrMap: Record<string, string>
}

// Office's built-in default theme — used when a deck omits theme1.xml so we
// never produce an undefined color.
const DEFAULT_THEME: Record<string, string> = {
  dk1: '000000',
  lt1: 'FFFFFF',
  dk2: '44546A',
  lt2: 'E7E6E6',
  accent1: '4472C4',
  accent2: 'ED7D31',
  accent3: 'A5A5A5',
  accent4: 'FFC000',
  accent5: '5B9BD5',
  accent6: '70AD47',
  hlink: '0563C1',
  folHlink: '954F72',
}

const DEFAULT_CLR_MAP: Record<string, string> = {
  bg1: 'lt1',
  tx1: 'dk1',
  bg2: 'lt2',
  tx2: 'dk2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hlink: 'hlink',
  folHlink: 'folHlink',
}

const THEME_SLOTS = [
  'dk1',
  'lt1',
  'dk2',
  'lt2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
] as const

const CLR_MAP_KEYS = Object.keys(DEFAULT_CLR_MAP)

// A handful of named preset colors that show up via <a:prstClr>.
const PRESET_COLORS: Record<string, string> = {
  black: '000000',
  white: 'FFFFFF',
  red: 'FF0000',
  green: '008000',
  blue: '0000FF',
  yellow: 'FFFF00',
  gray: '808080',
  grey: '808080',
  darkGray: 'A9A9A9',
  lightGray: 'D3D3D3',
  orange: 'FFA500',
  purple: '800080',
}

interface Rgb {
  r: number
  g: number
  b: number
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number) => clampByte(n).toString(16).padStart(2, '0')
  return (h(r) + h(g) + h(b)).toUpperCase()
}

/** Pull the first numeric `val` of an `<a:NAME val="…"/>` modifier, as 0–1. */
function modFactor(content: string, name: string): number | undefined {
  const m = content.match(new RegExp(`<a:${name}\\b[^>]*\\bval="(\\d+)"`))
  return m ? parseInt(m[1]) / 100000 : undefined
}

/**
 * Apply OOXML luminance/shade/tint modifiers in RGB space. This is an
 * approximation of the spec's HSL math but is visually close enough for the
 * common "accent1 lightened 60%" pattern decks rely on.
 */
function applyModifiers(rgb: Rgb, content: string): Rgb {
  let { r, g, b } = rgb
  const shade = modFactor(content, 'shade')
  if (shade !== undefined) {
    r *= shade
    g *= shade
    b *= shade
  }
  const tint = modFactor(content, 'tint')
  if (tint !== undefined) {
    r = r * tint + 255 * (1 - tint)
    g = g * tint + 255 * (1 - tint)
    b = b * tint + 255 * (1 - tint)
  }
  const lumMod = modFactor(content, 'lumMod')
  if (lumMod !== undefined) {
    r *= lumMod
    g *= lumMod
    b *= lumMod
  }
  const lumOff = modFactor(content, 'lumOff')
  if (lumOff !== undefined) {
    r += 255 * lumOff
    g += 255 * lumOff
    b += 255 * lumOff
  }
  return { r: clampByte(r), g: clampByte(g), b: clampByte(b) }
}

/** Resolve a logical/theme slot (e.g. "bg1", "accent1", "dk1") to a hex. */
function resolveSlot(slot: string | undefined, ctx: ColorContext): string | undefined {
  if (!slot || slot === 'phClr') return undefined
  let s = slot
  if (ctx.clrMap[s]) s = ctx.clrMap[s]
  return ctx.theme[s]
}

const COLOR_EL_RE = /<a:(srgbClr|schemeClr|sysClr|prstClr)\b([^>]*?)(\/>|>([\s\S]*?)<\/a:\1>)/

/**
 * Resolve the first color element inside `xml` (which may be a bare color tag
 * or a wrapper like <a:solidFill>…</a:solidFill>) to an RRGGBB hex (no #),
 * applying any luminance/shade/tint modifiers. Returns undefined when the
 * color can't be resolved (e.g. an unmapped theme slot).
 */
export function resolveColorElement(xml: string, ctx: ColorContext): string | undefined {
  const m = xml.match(COLOR_EL_RE)
  if (!m) return undefined
  const tag = m[1]
  const attrs = m[2]
  const content = m[4] ?? ''
  let base: string | undefined
  if (tag === 'srgbClr') {
    base = attrs.match(/val="([0-9A-Fa-f]{6})"/)?.[1]
  } else if (tag === 'sysClr') {
    base = attrs.match(/lastClr="([0-9A-Fa-f]{6})"/)?.[1]
    if (!base) {
      const val = attrs.match(/val="([^"]+)"/)?.[1]
      base = val === 'window' ? 'FFFFFF' : '000000'
    }
  } else if (tag === 'schemeClr') {
    base = resolveSlot(attrs.match(/val="([^"]+)"/)?.[1], ctx)
  } else if (tag === 'prstClr') {
    base = PRESET_COLORS[attrs.match(/val="([^"]+)"/)?.[1] ?? '']
  }
  if (!base || base.length !== 6) return undefined
  return rgbToHex(applyModifiers(hexToRgb(base.toUpperCase()), content))
}

/** Resolve the color inside the first <a:solidFill> of `xml`. */
export function resolveSolidFill(xml: string, ctx: ColorContext): string | undefined {
  const m = xml.match(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/)
  if (!m) return undefined
  return resolveColorElement(m[1], ctx)
}

function colorFromChunk(chunk: string): string | undefined {
  const srgb = chunk.match(/<a:srgbClr\b[^>]*val="([0-9A-Fa-f]{6})"/)
  if (srgb) return srgb[1].toUpperCase()
  const sys = chunk.match(/<a:sysClr\b[^>]*lastClr="([0-9A-Fa-f]{6})"/)
  if (sys) return sys[1].toUpperCase()
  return undefined
}

/**
 * Build a ColorContext from a deck's theme1.xml (color scheme) and the slide
 * master's <p:clrMap>. Falls back to Office defaults for anything missing.
 */
export async function loadColorContext(zip: JSZip): Promise<ColorContext> {
  const theme: Record<string, string> = { ...DEFAULT_THEME }
  const clrMap: Record<string, string> = { ...DEFAULT_CLR_MAP }

  const themeFile = zip.file('ppt/theme/theme1.xml')
  if (themeFile) {
    const xml = await themeFile.async('text')
    const scheme = xml.match(/<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/)
    if (scheme) {
      for (const slot of THEME_SLOTS) {
        const mm = scheme[0].match(new RegExp(`<a:${slot}>([\\s\\S]*?)</a:${slot}>`))
        const hex = mm ? colorFromChunk(mm[1]) : undefined
        if (hex) theme[slot] = hex
      }
    }
  }

  const masterFile = zip.file('ppt/slideMasters/slideMaster1.xml')
  if (masterFile) {
    const xml = await masterFile.async('text')
    const cm = xml.match(/<p:clrMap\b([^>]*)\/>/)
    if (cm) {
      for (const key of CLR_MAP_KEYS) {
        const v = cm[1].match(new RegExp(`\\b${key}="([^"]+)"`))
        if (v) clrMap[key] = v[1]
      }
    }
  }

  return { theme, clrMap }
}
