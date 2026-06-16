import type { KnowledgeLayer } from './types'

export type TemplateSource = 'pptx' | 'pdf' | 'keynote'

export interface StyleTokens {
  palette: {
    primary?: string
    accent?: string
    background?: string
    textPrimary?: string
    textMuted?: string
    danger?: string
    success?: string
  }
  typography: {
    fontFamily?: string
    headlineSize?: number
    bodySize?: number
    smallSize?: number
  }
}

export interface TemplateKnowledge {
  id: string
  filename: string
  source: TemplateSource
  slideCount: number
  colors: string[]
  fonts: string[]
  fontSizes: number[]
  knowledge: string
  styleTokens: StyleTokens
}

export interface TemplateParseInput {
  filename: string
  source: TemplateSource
  pageCount: number
  colors: string[]
  fonts: string[]
  fontSizes: number[]
  pageDescriptions: string[]
  layoutSample: string
}

function isDark(hex: string): boolean {
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return (r * 0.299 + g * 0.587 + b * 0.114) < 80
}

function isLight(hex: string): boolean {
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return (r * 0.299 + g * 0.587 + b * 0.114) > 200
}

export function inferStyleTokens(
  colors: string[],
  fonts: string[],
  fontSizes: number[]
): StyleTokens {
  const unique = Array.from(new Set(colors.map(c => c.toUpperCase())))
  const dark = unique.filter(isDark)
  const light = unique.filter(isLight)
  const chromatic = unique.filter(c => !isDark(c) && !isLight(c))

  const sortedSizes = Array.from(new Set(fontSizes)).sort((a, b) => b - a)

  return {
    palette: {
      background: dark[0],
      textPrimary: light[0] || 'FFFFFF',
      textMuted: light[1] || chromatic[0],
      primary: chromatic[0] || unique[0],
      accent: chromatic[1] || chromatic[0] || unique[1],
      danger: chromatic.find(c => {
        const r = parseInt(c.slice(0, 2), 16)
        return r > 180
      }),
      success: chromatic.find(c => {
        const g = parseInt(c.slice(2, 4), 16)
        return g > 150 && parseInt(c.slice(0, 2), 16) < 100
      }),
    },
    typography: {
      fontFamily: fonts[0],
      headlineSize: sortedSizes[0],
      bodySize: sortedSizes[Math.floor(sortedSizes.length / 2)] || sortedSizes[sortedSizes.length - 1],
      smallSize: sortedSizes[sortedSizes.length - 1],
    },
  }
}

export function buildTemplateKnowledge(input: TemplateParseInput): TemplateKnowledge {
  const styleTokens = inferStyleTokens(input.colors, input.fonts, input.fontSizes)
  const pageLabel = input.source === 'pdf' ? 'PAGE' : 'SLIDE'

  const tokenBlock = `STRUCTURED STYLE TOKENS (use these hex values directly in patches):
${JSON.stringify(styleTokens, null, 2)}

Mapping to element patches:
- slide background → slidePatch.bg = palette.background
- headlines → style.color = palette.textPrimary, style.fontSize = typography.headlineSize, style.fontFace = typography.fontFamily
- body text → style.color = palette.textMuted or textPrimary, style.fontSize = typography.bodySize
- accent bars/chips → style.bg = palette.accent or primary
- danger/warning → style.bg = palette.danger, style.color = FFFFFF`

  const knowledge = `TEMPLATE ANALYSIS: "${input.filename}" (${input.source.toUpperCase()})
======================================

${pageLabel} COUNT: ${input.pageCount}

COLOR PALETTE (hex, no # prefix in patches):
${input.colors.map(c => `  ${c}`).join('  ')}

TYPOGRAPHY:
  Fonts: ${input.fonts.join(', ') || 'default'}
  Font sizes (pt): ${input.fontSizes.join(', ')}

${pageLabel} OVERVIEW:
${input.pageDescriptions.join('\n')}

LAYOUT SAMPLE:
${input.layoutSample}

${tokenBlock}

DESIGN GUIDELINES:
- Match this template's colors, fonts, and visual hierarchy when editing slides.
- Use style.bg for bar/rect/chip fills, style.color for text.
- Apply palette roles from STRUCTURED STYLE TOKENS unless the user specifies otherwise.`

  return {
    id: `${input.source}-${input.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}-${Date.now()}`,
    filename: input.filename,
    source: input.source,
    slideCount: input.pageCount,
    colors: input.colors,
    fonts: input.fonts,
    fontSizes: input.fontSizes,
    styleTokens,
    knowledge,
  }
}

export function mergeTemplatesKnowledge(templates: TemplateKnowledge[]): string {
  if (templates.length === 0) return ''
  if (templates.length === 1) return templates[0].knowledge

  const mergedColors = Array.from(new Set(templates.flatMap(t => t.colors)))
  const mergedFonts = Array.from(new Set(templates.flatMap(t => t.fonts)))
  const mergedSizes = Array.from(new Set(templates.flatMap(t => t.fontSizes))).sort((a, b) => a - b)
  const mergedTokens = inferStyleTokens(mergedColors, mergedFonts, mergedSizes)

  const perFile = templates
    .map((t, i) => `### Template ${i + 1}: ${t.filename} (${t.source.toUpperCase()})\n${t.knowledge}`)
    .join('\n\n')

  return `MULTIPLE DESIGN TEMPLATES (${templates.length} files)
==========================================

${perFile}

COMBINED STYLE TOKENS (merged palette & typography from all templates):
${JSON.stringify(mergedTokens, null, 2)}

When editing, reconcile styles across all uploaded templates. Prefer the combined tokens
unless the user names a specific template file to follow.`
}

export function templateToKnowledgeLayer(t: TemplateKnowledge) {
  return {
    id: `template-${t.id}`,
    type: 'style' as const,
    name: `Template: ${t.filename}`,
    content: t.knowledge,
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source: 'template' as const,
  }
}

export function syncTemplateKnowledgeLayers(
  templates: TemplateKnowledge[],
  otherLayers: KnowledgeLayer[]
) {
  const nonTemplate = otherLayers.filter(l => l.source !== 'template')
  return [...nonTemplate, ...templates.map(templateToKnowledgeLayer)]
}

/** Merge new templates into existing list by filename (re-upload replaces same name). */
export function mergeTemplateList(
  existing: TemplateKnowledge[],
  incoming: TemplateKnowledge[]
): TemplateKnowledge[] {
  const byFilename = new Map(existing.map(t => [t.filename, t]))
  for (const t of incoming) {
    byFilename.set(t.filename, t)
  }
  return Array.from(byFilename.values())
}
