import { buildDesignSystem, type DSFile, type DesignSystem } from './designSystem'

export type DesignSystemPresetId = 'general-light' | 'general-dark' | 'warm-beige'

export type DesignSystemPresetMeta = {
  id: DesignSystemPresetId
  name: string
  tagline: string
  previewBg: string
  previewText: string
  previewAccent: string
}

const GENERAL_LIGHT_CSS = `:root {
  --bg-default: #FFFFFF;
  --bg-paper: #F8FAFC;
  --text-primary: #0F172A;
  --text-secondary: #475569;
  --text-tertiary: #64748B;
  --primary: #1E40AF;
  --secondary: #2563EB;
  --tertiary: #3B82F6;
  --accent: #2563EB;
  --error: #DC2626;
  --success: #059669;
  --font-family: Calibri, "Segoe UI", Arial, sans-serif;
  --text-xs: 10pt;
  --text-sm: 12pt;
  --text-base: 16pt;
  --text-lg: 20pt;
  --text-xl: 28pt;
  --text-2xl: 36pt;
  --radius-md: 4px;
  --space-4: 16px;
}`

const GENERAL_DARK_CSS = `:root {
  --bg-default: #0D1B2A;
  --bg-paper: #112236;
  --text-primary: #FFFFFF;
  --text-secondary: #CBD5E1;
  --text-tertiary: #94A3B8;
  --primary: #60A5FA;
  --secondary: #3B82F6;
  --tertiary: #F59E0B;
  --accent: #F59E0B;
  --error: #F87171;
  --success: #34D399;
  --font-family: Calibri, "Segoe UI", Arial, sans-serif;
  --text-xs: 10pt;
  --text-sm: 12pt;
  --text-base: 16pt;
  --text-lg: 20pt;
  --text-xl: 28pt;
  --text-2xl: 36pt;
  --radius-md: 4px;
  --space-4: 16px;
}`

const GENERAL_LIGHT_RULES = `General White (Light) — built-in sample design system.

- Clean white slide backgrounds with navy headlines and slate body text.
- Accent bars and chips use blue (#2563EB). Use gold only when the user asks for a warm accent.
- Typography: Calibri throughout — 28pt titles, 16pt body, 12pt labels.
- Section slides: thin top accent bar (style.bg accent) + title left-aligned with consistent margins.
- Charts: blue primary series; keep backgrounds transparent on light slides.`

const GENERAL_DARK_RULES = `General Dark — built-in sample design system.

- Deep navy slide backgrounds (#0D1B2A) with white primary text and muted slate secondary text.
- Gold accent bar (#F59E0B) for headers, KPI chips, and emphasis shapes.
- Typography: Calibri throughout — 28pt titles, 16pt body, 12pt labels.
- Section slides: gold top accent bar + white title; body copy in #CBD5E1.
- Charts: blue + gold series on dark backgrounds; never use light-grey text on white fills.`

const WARM_BEIGE_CSS = `:root {
  --bg-default: #FAF7F2;
  --bg-paper: #F0EAE0;
  --text-primary: #2C1A0E;
  --text-secondary: #6B4A2E;
  --text-tertiary: #9A7A5A;
  --primary: #B5682A;
  --secondary: #C97E45;
  --tertiary: #E0A96D;
  --accent: #B5682A;
  --error: #A63232;
  --success: #4A7A4A;
  --font-family: Georgia, "Times New Roman", serif;
  --text-xs: 10pt;
  --text-sm: 12pt;
  --text-base: 16pt;
  --text-lg: 20pt;
  --text-xl: 28pt;
  --text-2xl: 36pt;
  --radius-md: 6px;
  --space-4: 16px;
}`

const WARM_BEIGE_RULES = `Warm Beige — built-in sample design system.

- Warm cream slide backgrounds (#FAF7F2) with deep espresso primary text (#2C1A0E) and caramel body text.
- Accent bars, chips, and dividers use burnt sienna (#B5682A). Avoid cold blues — this palette is warm throughout.
- Typography: Georgia serif for titles (28pt), Calibri/sans for body (16pt) and labels (12pt).
- Section slides: thin caramel rule line below the title; off-white card panels for content blocks.
- Charts: amber and caramel series on cream backgrounds; no cool-grey fills.
- Cards and callout boxes: use --bg-paper (#F0EAE0) fill with a 1px caramel border.`

export const DESIGN_SYSTEM_PRESETS: DesignSystemPresetMeta[] = [
  {
    id: 'general-light',
    name: 'General White (Light)',
    tagline: 'White slides · navy text · blue accent',
    previewBg: 'FFFFFF',
    previewText: '0F172A',
    previewAccent: '2563EB',
  },
  {
    id: 'general-dark',
    name: 'General Dark',
    tagline: 'Navy slides · white text · gold accent',
    previewBg: '0D1B2A',
    previewText: 'FFFFFF',
    previewAccent: 'F59E0B',
  },
  {
    id: 'warm-beige',
    name: 'Warm Beige',
    tagline: 'Cream slides · espresso text · caramel accent',
    previewBg: 'FAF7F2',
    previewText: '2C1A0E',
    previewAccent: 'B5682A',
  },
]

function presetFiles(presetId: DesignSystemPresetId): DSFile[] {
  const css =
    presetId === 'general-light' ? GENERAL_LIGHT_CSS :
    presetId === 'general-dark'  ? GENERAL_DARK_CSS  :
    WARM_BEIGE_CSS
  const rules =
    presetId === 'general-light' ? GENERAL_LIGHT_RULES :
    presetId === 'general-dark'  ? GENERAL_DARK_RULES  :
    WARM_BEIGE_RULES
  return [
    {
      id: `preset-${presetId}-css`,
      name: `${presetId}-tokens.css`,
      category: 'stylesheet',
      size: css.length,
      text: css,
    },
    {
      id: `preset-${presetId}-rules`,
      name: `${presetId}-rules.md`,
      category: 'document',
      size: rules.length,
      text: rules,
    },
  ]
}

export function buildPresetDesignSystem(
  dsId: string,
  presetId: DesignSystemPresetId
): DesignSystem {
  const meta = DESIGN_SYSTEM_PRESETS.find(p => p.id === presetId)
  if (!meta) throw new Error(`Unknown design system preset: ${presetId}`)
  return buildDesignSystem(dsId, meta.name, presetFiles(presetId))
}

export function isPresetDesignSystemFile(fileId: string): boolean {
  return fileId.startsWith('preset-')
}
