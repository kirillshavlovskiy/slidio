/** Default when an element has no fontFace set. */
export const DEFAULT_FONT = 'Calibri'

/**
 * Curated presentation typefaces, grouped for the font picker.
 * System/Office fonts rely on OS installs; web fonts are loaded via Google Fonts in layout.
 */
export const FONT_GROUPS = {
  Popular: [
    'Inter',
    'Roboto',
    'Open Sans',
    'Lato',
    'Montserrat',
    'Poppins',
    'Source Sans 3',
  ],
  'Sans Serif': [
    'Nunito',
    'Raleway',
    'Work Sans',
    'DM Sans',
    'IBM Plex Sans',
    'Noto Sans',
    'Fira Sans',
    'PT Sans',
    'Ubuntu',
    'Oswald',
    'Helvetica Neue',
    'Helvetica',
    'Arial',
    'Verdana',
    'Tahoma',
    'Trebuchet MS',
    'Segoe UI',
    'Calibri',
    'Aptos',
    'Candara',
    'Franklin Gothic Medium',
  ],
  Serif: [
    'Merriweather',
    'Playfair Display',
    'Lora',
    'Source Serif 4',
    'Libre Baskerville',
    'Noto Serif',
    'PT Serif',
    'Georgia',
    'Times New Roman',
    'Palatino Linotype',
    'Garamond',
    'Cambria',
    'Book Antiqua',
  ],
  Monospace: [
    'IBM Plex Mono',
    'Source Code Pro',
    'JetBrains Mono',
    'Fira Code',
    'Consolas',
    'Courier New',
    'Monaco',
  ],
  Display: ['Impact', 'Bebas Neue', 'Anton', 'Archivo Black'],
} as const

/** Flat, deduplicated list — backward compatible with existing imports. */
export const FONT_OPTIONS = Array.from(
  new Set(Object.values(FONT_GROUPS).flat())
) as string[]

export type FontOption = (typeof FONT_OPTIONS)[number]

/** Fonts loaded from Google Fonts (not guaranteed as system installs). */
const GOOGLE_FONT_FAMILIES = new Set([
  'Inter',
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Source Sans 3',
  'Nunito',
  'Raleway',
  'Work Sans',
  'DM Sans',
  'IBM Plex Sans',
  'Noto Sans',
  'Fira Sans',
  'PT Sans',
  'Ubuntu',
  'Oswald',
  'Merriweather',
  'Playfair Display',
  'Lora',
  'Source Serif 4',
  'Libre Baskerville',
  'Noto Serif',
  'PT Serif',
  'IBM Plex Mono',
  'Source Code Pro',
  'JetBrains Mono',
  'Fira Code',
  'Bebas Neue',
  'Anton',
  'Archivo Black',
])

function googleFamilyParam(name: string): string {
  return `family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@100..900`
}

/** Single stylesheet URL for all bundled web fonts (used in root layout). */
export function googleFontsStylesheetUrl(): string {
  const families = FONT_OPTIONS.filter(f => GOOGLE_FONT_FAMILIES.has(f))
    .map(googleFamilyParam)
    .join('&')
  return `https://fonts.googleapis.com/css2?${families}&display=swap`
}

const SERIF_HINT =
  /georgia|times|palatino|garamond|cambria|book antiqua|merriweather|playfair|lora|serif|baskerville/i
const MONO_HINT =
  /courier|mono|consolas|monaco|jetbrains|fira code|ibm plex mono|source code/i

export function fontFamilyCss(fontFace?: string): string {
  const name = fontFace || DEFAULT_FONT
  const fallback = MONO_HINT.test(name)
    ? 'monospace'
    : SERIF_HINT.test(name)
      ? 'serif'
      : 'sans-serif'
  return `"${name}", ${fallback}`
}

/** Collect unique fontFace values used on a deck (for picker "In deck" section). */
export function fontsUsedOnSlides(
  slides: { elements: { style?: { fontFace?: string } }[] }[]
): string[] {
  const seen = new Set<string>()
  for (const slide of slides) {
    for (const el of slide.elements) {
      const face = el.style?.fontFace?.trim()
      if (face) seen.add(face)
    }
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b))
}

/** Fonts on the deck / design system that are not in the bundled catalog. */
export function extraFontsForPicker(
  catalog: readonly string[],
  ...sources: (readonly string[] | undefined)[]
): string[] {
  const known = new Set(catalog.map(f => f.toLowerCase()))
  const out = new Set<string>()
  for (const src of sources) {
    if (!src) continue
    for (const f of src) {
      const t = f.trim()
      if (t && !known.has(t.toLowerCase())) out.add(t)
    }
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b))
}
