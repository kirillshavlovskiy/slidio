export const DEFAULT_FONT = 'Calibri'

export const FONT_OPTIONS = [
  'Calibri',
  'Arial',
  'Georgia',
  'Times New Roman',
  'Verdana',
  'Trebuchet MS',
  'Courier New',
  'Impact',
  'Palatino Linotype',
  'Segoe UI',
] as const

export type FontOption = (typeof FONT_OPTIONS)[number]

export function fontFamilyCss(fontFace?: string): string {
  const name = fontFace || DEFAULT_FONT
  const fallback =
    name.includes('Courier') || name.includes('Mono')
      ? 'monospace'
      : name.includes('Georgia') || name.includes('Times') || name.includes('Palatino')
        ? 'serif'
        : 'sans-serif'
  return `"${name}", ${fallback}`
}
