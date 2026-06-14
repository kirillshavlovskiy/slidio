import type { KnowledgeLayer } from './types'
import { inferStyleTokens, StyleTokens } from './templateKnowledge'
import { idbGet, idbSet, idbDel } from './dsStorage'

/**
 * Design System ingestion.
 *
 * A design system package (e.g. the "_ds/<name>" export) is uploaded file-by-file
 * into category sections. We parse the high-signal parts — the colors/type
 * stylesheet (resolving CSS var() chains), the manifest token list, adherence
 * rules, README and font files — into accurate semantic StyleTokens + an
 * authoritative knowledge blob that the AI editor/agent FOLLOWS when it creates or
 * edits slides. It plugs into the same knowledge-layer pipeline as templates.
 */

export type DSCategory =
  | 'stylesheet'
  | 'data'
  | 'document'
  | 'script'
  | 'font'
  | 'logo'
  | 'component'
  | 'preview'
  | 'rulebook'
  | 'other'

export interface DSFile {
  id: string
  name: string
  category: DSCategory
  size: number
  /** Decoded text for parseable categories (css / json / md / js). */
  text?: string
  /** base64 data URL for binary assets (fonts) so they can be loaded via @font-face. */
  dataUrl?: string
}

export interface DSColorToken {
  name: string // e.g. "--primary"
  hex: string // 6-digit, no #
}

export interface DSLogo {
  name: string
  src: string // data URL
}

export interface DSNamedValue {
  name: string
  value: string
}

export interface DSTokens {
  /** All resolved color tokens (semantic + raw palette scales). */
  colorVars: DSColorToken[]
  /** Just the semantic color tokens (primary, bg-*, text-*, error, …). */
  semanticColors: DSColorToken[]
  /** Semantic color tokens under the dark theme (empty if no dark theme). */
  semanticColorsDark: DSColorToken[]
  /** Unique hexes, no #. */
  palette: string[]
  fontFamilies: string[]
  typeScale: string[]
  radii: DSNamedValue[]
  spacing: DSNamedValue[]
  shadows: DSNamedValue[]
  rules: string[]
  /** Brand logos uploaded with the design system (insertable onto slides). */
  logos: DSLogo[]
}

export interface DesignSystem {
  id: string
  name: string
  files: DSFile[]
  tokens: DSTokens
  styleTokens: StyleTokens
  /** Semantic StyleTokens under the dark theme (present only if the system has one). */
  styleTokensDark?: StyleTokens
  hasDark: boolean
  knowledge: string
}

type VarMap = Map<string, string>

// ── Low-level value helpers ─────────────────────────────────────────────────────

function normalizeHex(raw: string): string | null {
  const s = raw.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase()
  if (/^[0-9a-fA-F]{8}$/.test(s)) return s.slice(0, 6).toUpperCase()
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    const [r, g, b] = s.split('')
    return (r + r + g + g + b + b).toUpperCase()
  }
  return null
}

function rgbToHex(r: number, g: number, b: number): string {
  return [r, g, b]
    .map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

function hexFromValue(value: string): string | null {
  const direct = normalizeHex(value)
  if (direct) return direct
  const rgb = value.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
  if (rgb) return rgbToHex(+rgb[1], +rgb[2], +rgb[3])
  const inline = value.match(/#([0-9a-fA-F]{3,8})\b/)
  if (inline) return normalizeHex(inline[1])
  return null
}

function extractHexes(text: string): string[] {
  const set = new Set<string>()
  for (const m of text.matchAll(/#([0-9a-fA-F]{6})\b/g)) set.add(m[1].toUpperCase())
  for (const m of text.matchAll(/#([0-9a-fA-F]{3})\b/g)) {
    const h = normalizeHex(m[1])
    if (h) set.add(h)
  }
  for (const m of text.matchAll(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/gi)) {
    set.add(rgbToHex(+m[1], +m[2], +m[3]))
  }
  return Array.from(set)
}

function firstFamily(value: string): string | null {
  const first = value.split(',')[0].trim().replace(/^["']|["']$/g, '')
  if (
    !first ||
    first.startsWith('var(') ||
    /^(inherit|initial|unset|none|auto|normal|sans-serif|serif|monospace|ui-monospace|ui-sans-serif|ui-serif|system-ui)$/i.test(first) ||
    // Reject numeric / unit values (font-weight, font-size, line-height tokens).
    /^[\d.]+(px|rem|em|pt|%|vh|vw|ex|ch)?$/i.test(first) ||
    // Reject weight / style keywords that aren't font families.
    /^(bold|bolder|lighter|italic|oblique|thin|light|medium|regular|semibold|black|heavy|condensed|expanded|[1-9]00)$/i.test(first)
  )
    return null
  return first
}

/** Dedupe a list of font families ignoring case, keeping first-seen casing. */
function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

/** True when a CSS custom-property name denotes a font *family* (not size/weight/etc). */
function isFontFamilyVar(name: string): boolean {
  if (/^--text-/.test(name)) return false
  if (/(weight|size|leading|line-?height|spacing|kerning|tracking|variant|feature|style|stretch|width)/i.test(name))
    return false
  return /(font|typeface|family)/i.test(name)
}

function familyFromFontFile(filename: string): string {
  return filename
    .replace(/\.(woff2?|ttf|otf|eot)$/i, '')
    .replace(/\(\s*\d+\s*\)/g, '') // strip "(1)" duplicate-download suffixes
    .replace(/[-_]+/g, ' ')
    .replace(
      /\b(thin|hairline|extralight|ultralight|light|regular|book|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|italic|oblique|variable|vf|pro|std)\b/gi,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim()
}

/** Follow `var(--x, fallback)` chains to a concrete value. */
function resolveValue(value: string, map: VarMap, seen: Set<string> = new Set()): string {
  const v = value.trim()
  const m = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/)
  if (!m) return v
  const ref = m[1]
  if (!seen.has(ref)) {
    seen.add(ref)
    const referenced = map.get(ref)
    if (referenced != null) return resolveValue(referenced, map, seen)
  }
  return m[2] ? resolveValue(m[2], map, seen) : v
}

// ── CSS / manifest extraction ────────────────────────────────────────────────────

/** Pull `--name: value;` pairs from :root blocks only (skip dark-theme overrides). */
function extractRootVars(css: string): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = []
  for (const block of css.matchAll(/:root\s*\{([\s\S]*?)\}/g)) {
    for (const m of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      out.push({ name: m[1].trim(), value: m[2].trim() })
    }
  }
  return out
}

/** Pull `--name: value;` pairs from blocks whose selector matches (e.g. dark theme). */
function extractScopedVars(css: string, selectorRe: RegExp): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = []
  for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorRe.test(block[1])) continue
    for (const m of block[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      out.push({ name: m[1].trim(), value: m[2].trim() })
    }
  }
  return out
}

const RAW_SCALE_RE = /^--(grey|beige|blue|purple|red|green|yellow|orange|magenta)-/

/** Resolve all color tokens in a var map to hex (returns named tokens + flat palette). */
function classifyColors(map: VarMap): { colorVars: DSColorToken[]; palette: Set<string> } {
  const colorVars: DSColorToken[] = []
  const palette = new Set<string>()
  const seen = new Set<string>()
  for (const [n, raw] of map) {
    if (/^--space/.test(n) || /radius/.test(n) || /shadow|elevation/.test(n)) continue
    if (/font/.test(n) && !/^--text-/.test(n)) continue
    if (/^--(bp|z|duration|ease)/.test(n)) continue
    const hex = hexFromValue(resolveValue(raw, map))
    if (hex) {
      if (!seen.has(n)) {
        colorVars.push({ name: n, hex })
        seen.add(n)
      }
      palette.add(hex)
    }
  }
  return { colorVars, palette }
}

/** Build accurate semantic StyleTokens from a resolved name→hex map. */
function semanticStyleTokens(
  byName: Map<string, string>,
  fontArr: string[],
  ptSizes: number[]
): StyleTokens {
  const pick = (...names: string[]) => {
    for (const nm of names) {
      const hit = byName.get(nm)
      if (hit) return hit
    }
    return undefined
  }
  return {
    palette: {
      background: pick('--bg-default', '--brand-bed', '--bg-paper'),
      textPrimary: pick('--text-primary', '--primary') || 'FFFFFF',
      textMuted: pick('--text-secondary', '--text-tertiary'),
      primary: pick('--primary', '--brand'),
      accent: pick('--tertiary', '--secondary'),
      danger: pick('--error'),
      success: pick('--success'),
    },
    typography: {
      fontFamily: fontArr[0],
      headlineSize: ptSizes[0],
      bodySize: ptSizes[Math.floor(ptSizes.length / 2)] || ptSizes[ptSizes.length - 1],
      smallSize: ptSizes[ptSizes.length - 1],
    },
  }
}

function extractTypeScale(css: string): string[] {
  const set = new Set<string>()
  // Literal font-size rules.
  for (const m of css.matchAll(/font-size\s*:\s*([0-9.]+(?:px|rem|em|pt))/gi)) set.add(m[1])
  // Size tokens declared as custom properties (e.g. --text-lg / --font-size-xl / --fs-2).
  for (const m of css.matchAll(
    /--(?:text|font-size|fontsize|fs|type-?scale)[\w-]*\s*:\s*([0-9.]+(?:px|rem|em|pt))/gi
  ))
    set.add(m[1])
  return Array.from(set)
}

interface ManifestToken {
  name: string
  value: string
  kind?: string
  scope?: string
}

// ── Compose a DesignSystem from the uploaded files ──────────────────────────────

export function buildDesignSystem(id: string, rawName: string, files: DSFile[]): DesignSystem {
  let name = rawName.trim()
  const cssTexts: string[] = []
  const manifestTokens: ManifestToken[] = []
  const fontFamilies = new Set<string>()
  const typeScale = new Set<string>()
  const rules: string[] = []
  const extraPalette = new Set<string>()
  const logos: DSLogo[] = []

  for (const f of files) {
    const text = f.text ?? ''

    if (f.category === 'stylesheet' && text) {
      cssTexts.push(text)
    } else if (f.category === 'font') {
      const fam = familyFromFontFile(f.name)
      if (fam) fontFamilies.add(fam)
    } else if (f.category === 'logo') {
      if (f.dataUrl) logos.push({ name: f.name, src: f.dataUrl })
    } else if (f.category === 'document' && text) {
      const trimmed = text.replace(/\r/g, '').trim().slice(0, 6000)
      if (trimmed) rules.push(`From ${f.name}:\n${trimmed}`)
    } else if (f.category === 'data' && text) {
      extractHexes(text).forEach(h => extraPalette.add(h))
      try {
        const json = JSON.parse(text) as Record<string, unknown>
        if (!name && typeof json.name === 'string') name = json.name
        if (!name && typeof json.namespace === 'string') name = json.namespace

        // Manifest token list (authoritative resolved tokens).
        if (Array.isArray(json.tokens)) {
          for (const t of json.tokens as ManifestToken[]) {
            if (t && typeof t.name === 'string' && typeof t.value === 'string') manifestTokens.push(t)
          }
        }
        // Fonts declared in manifest / brandFonts (string entries or objects).
        for (const key of ['fonts', 'brandFonts', 'fontFamilies', 'typefaces']) {
          const arr = json[key]
          if (Array.isArray(arr)) {
            for (const item of arr) {
              if (typeof item === 'string') {
                const fam = firstFamily(item)
                if (fam) fontFamilies.add(fam)
              } else if (item && typeof item === 'object') {
                const o = item as Record<string, unknown>
                const fam = (o.family || o.name || o.fontFamily || o.value) as string | undefined
                if (typeof fam === 'string') {
                  const f = firstFamily(fam)
                  if (f) fontFamilies.add(f)
                }
              }
            }
          }
        }
        // Adherence: x-omelette token kinds + allowed font families.
        const omelette = json['x-omelette'] as Record<string, unknown> | undefined
        if (omelette && Array.isArray(omelette.fontFamilies)) {
          ;(omelette.fontFamilies as string[]).forEach(fam => fam && fontFamilies.add(fam))
        }
        // Adherence: surface lint rule messages (what NOT to do).
        const eslintRules = json.rules as Record<string, unknown> | undefined
        if (eslintRules && json.plugins) {
          const msgs: string[] = []
          const walk = (node: unknown) => {
            if (Array.isArray(node)) node.forEach(walk)
            else if (node && typeof node === 'object') {
              const obj = node as Record<string, unknown>
              if (typeof obj.message === 'string') msgs.push(obj.message)
              Object.values(obj).forEach(walk)
            }
          }
          walk(eslintRules)
          if (msgs.length) rules.push(`Adherence rules (${f.name}):\n- ${msgs.join('\n- ')}`)
        }
        // Manifest card / component catalog → list of available patterns.
        if (Array.isArray(json.cards)) {
          const names = (json.cards as Array<{ name?: string }>)
            .map(c => c?.name)
            .filter(Boolean)
            .slice(0, 60)
          if (names.length) rules.push(`Design-system components & previews available: ${names.join(', ')}`)
        }
      } catch {
        // not valid JSON — hexes already harvested
      }
    }
  }

  // Build the variable map: CSS :root vars first, then manifest light-scope tokens.
  // Also collect dark-theme overrides so we can produce a dark variant.
  const varMap: VarMap = new Map()
  const darkOverrides: VarMap = new Map()
  for (const css of cssTexts) {
    for (const { name: n, value } of extractRootVars(css)) varMap.set(n, value)
    for (const { name: n, value } of extractScopedVars(css, /theme-dark|data-theme/))
      darkOverrides.set(n, value)
    extractTypeScale(css).forEach(s => typeScale.add(s))
    for (const m of css.matchAll(/font-family\s*:\s*([^;}{]+)[;}]/gi)) {
      const fam = firstFamily(m[1])
      if (fam) fontFamilies.add(fam)
    }
  }
  for (const t of manifestTokens) {
    if (t.scope) {
      // Scoped overrides (e.g. ".theme-dark") feed the dark variant.
      if (/dark/i.test(t.scope) && !darkOverrides.has(t.name)) darkOverrides.set(t.name, t.value)
      continue
    }
    if (!varMap.has(t.name)) varMap.set(t.name, t.value)
  }

  // Non-color scales (shared across themes) come from the light map.
  const radii: DSNamedValue[] = []
  const spacing: DSNamedValue[] = []
  const shadows: DSNamedValue[] = []
  for (const [n, raw] of varMap) {
    const resolved = resolveValue(raw, varMap)
    if (/^--space/.test(n)) spacing.push({ name: n, value: resolved })
    else if (/radius/.test(n)) radii.push({ name: n, value: resolved })
    else if (/shadow|elevation/.test(n) && resolved !== 'none')
      shadows.push({ name: n, value: resolved })
    else if (isFontFamilyVar(n)) {
      const fam = firstFamily(resolved)
      if (fam) fontFamilies.add(fam)
    }
  }

  // Light colors.
  const { colorVars, palette } = classifyColors(varMap)
  extraPalette.forEach(h => palette.add(h))
  const semanticColors = colorVars.filter(v => !RAW_SCALE_RE.test(v.name))

  // Dark colors = light map overlaid with dark overrides.
  const hasDark = darkOverrides.size > 0
  const darkMap: VarMap = new Map(varMap)
  for (const [n, v] of darkOverrides) darkMap.set(n, v)
  const darkColors = hasDark ? classifyColors(darkMap) : null
  const semanticColorsDark = darkColors
    ? darkColors.colorVars.filter(v => !RAW_SCALE_RE.test(v.name))
    : []

  const fontArr = dedupeCaseInsensitive(Array.from(fontFamilies))
  const scaleArr = Array.from(typeScale)
  const ptSizes = scaleArr
    .map(s => {
      const m = s.match(/^([0-9.]+)(px|rem|em|pt)$/)
      if (!m) return null
      const nnum = parseFloat(m[1])
      return Math.round(m[2] === 'rem' || m[2] === 'em' ? nnum * 16 : nnum)
    })
    .filter((nnum): nnum is number => nnum != null)
    .sort((a, b) => b - a)

  const styleTokens: StyleTokens =
    semanticColors.length > 0
      ? semanticStyleTokens(new Map(colorVars.map(v => [v.name, v.hex])), fontArr, ptSizes)
      : inferStyleTokens(Array.from(palette), fontArr, ptSizes)

  const styleTokensDark =
    hasDark && darkColors
      ? semanticStyleTokens(new Map(darkColors.colorVars.map(v => [v.name, v.hex])), fontArr, ptSizes)
      : undefined

  const tokens: DSTokens = {
    colorVars,
    semanticColors,
    semanticColorsDark,
    palette: Array.from(palette),
    fontFamilies: fontArr,
    typeScale: scaleArr,
    radii,
    spacing,
    shadows,
    rules,
    logos,
  }

  return {
    id,
    name: name || 'Design System',
    files,
    tokens,
    styleTokens,
    styleTokensDark,
    hasDark,
    knowledge: buildDesignSystemKnowledge(name || 'Design System', tokens, styleTokens, styleTokensDark),
  }
}

export function buildDesignSystemKnowledge(
  name: string,
  tokens: DSTokens,
  styleTokens: StyleTokens,
  styleTokensDark?: StyleTokens
): string {
  const semantic = tokens.semanticColors.slice(0, 80).map(v => `  ${v.name}: ${v.hex}`).join('\n')
  const radii = tokens.radii.map(r => `${r.name.replace('--radius-', '')}=${r.value}`).join(', ')
  const spacing = tokens.spacing.map(s => s.value).join(', ')
  const shadows = tokens.shadows.map(s => `  ${s.name.replace('--shadow-', '')}: ${s.value}`).join('\n')

  const darkSemantic = tokens.semanticColorsDark
    .slice(0, 80)
    .map(v => `  ${v.name}: ${v.hex}`)
    .join('\n')
  const darkBlock = styleTokensDark
    ? `

DARK THEME VARIANT — this system supports BOTH light (default) and dark.
Produce the LIGHT version by default. When the user asks for a DARK version (or "dark mode"),
use these dark tokens instead — swap the slide background, paper, text and accent colours:
DARK SEMANTIC COLOR TOKENS (role → hex):
${darkSemantic || '  (see dark style tokens)'}

DARK STRUCTURED STYLE TOKENS:
${JSON.stringify(styleTokensDark, null, 2)}`
    : ''

  return `DESIGN SYSTEM: "${name}" — AUTHORITATIVE
====================================================
This is the canonical design system. When creating or editing ANY slide, follow it as the
source of truth: use ONLY these colors, fonts and scales unless the user explicitly overrides.
Prefer the SEMANTIC tokens (map roles correctly) over raw palette shades.

SEMANTIC COLOR TOKENS (role → hex, no # in patches):
${semantic || '  (none — see palette)'}

FULL PALETTE (all hex, no #):
${tokens.palette.length ? tokens.palette.map(c => `  ${c}`).join('  ') : '  (none)'}

TYPOGRAPHY:
  Font families: ${tokens.fontFamilies.join(', ') || '(none)'}
  Type scale: ${tokens.typeScale.join(', ') || '(none)'}

RADII: ${radii || '(none)'}
SPACING SCALE: ${spacing || '(none)'}
${tokens.shadows.length ? `SHADOWS:\n${shadows}\n` : ''}
STRUCTURED STYLE TOKENS (use directly in patches):
${JSON.stringify(styleTokens, null, 2)}

Mapping to element patches:
- slide background → slidePatch.bg = palette.background
- headlines → style.color = palette.textPrimary, style.fontSize = typography.headlineSize, style.fontFace = typography.fontFamily
- body text → style.color = palette.textMuted or textPrimary, style.fontSize = typography.bodySize
- accent bars / chips / rects → style.bg = palette.accent or primary
- danger/warning → style.bg = palette.danger, style.color = FFFFFF
${
  tokens.logos.length
    ? `\nBRAND LOGOS (insert as real images — NEVER type the brand name as text):
${tokens.logos.map(l => `  - ${l.name}`).join('\n')}
To place a logo, add an IMAGE element with src set to "logo:<NAME>" using one of the names above,
e.g. { op:"add", element:{ id:"<unique>", type:"image", src:"logo:${tokens.logos[0].name}", x, y, w, h, style:{ objectFit:"contain" } } }.
The app swaps "logo:<NAME>" for the actual image. Pick a size that fits (a corner logo ≈ 1.2×0.4in) and
place it so it does NOT overlap existing titles/content (e.g. a free corner). Set style.invert=true if the
logo's colors clash with the slide background (dark logo on a dark slide).`
    : ''
}
${darkBlock}

DESIGN RULES & ADHERENCE:
${tokens.rules.length ? tokens.rules.map(r => `- ${r}`).join('\n\n') : '- (none provided)'}

RULES:
- Use ONLY colors from this palette/tokens unless the user explicitly names another colour.
- Use the design system's font families and type scale for all text.
- Respect the radii, spacing and shadow scales above.
- This design system overrides generic/default styling.`
}

// ── Knowledge-layer plumbing (reuses the template pipeline) ─────────────────────

export function designSystemToKnowledgeLayer(ds: DesignSystem): KnowledgeLayer {
  return {
    id: `ds-${ds.id}`,
    type: 'style',
    name: `Design System: ${ds.name}`,
    content: ds.knowledge,
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source: 'designSystem',
  }
}

/** Replace the design-system layer(s) in the deck's knowledge with the current one. */
export function syncDesignSystemLayers(
  ds: DesignSystem | null,
  otherLayers: KnowledgeLayer[]
): KnowledgeLayer[] {
  const nonDs = otherLayers.filter(l => l.source !== 'designSystem')
  if (!ds || ds.files.length === 0) return nonDs
  return [...nonDs, designSystemToKnowledgeLayer(ds)]
}

// ── Design-token view (for the editor's typography / design tools) ───────────────

export interface DesignTokensView {
  /** Font families declared by the design system. */
  fonts: string[]
  /** Flat palette (hex, no #). */
  palette: string[]
  /** Semantic, named color tokens (role → hex). */
  colorTokens: DSColorToken[]
  /** Type scale converted to point sizes, largest first. */
  typeScalePt: number[]
  /** Brand logos (insertable onto slides). */
  logos: DSLogo[]
}

/** Project a DesignSystem into the tokens the on-canvas editing tools consume. */
export function designTokensView(ds: DesignSystem | null): DesignTokensView | null {
  if (!ds || ds.files.length === 0) return null
  const toPt = (raw: string): number | null => {
    const m = raw.match(/^([0-9.]+)(px|rem|em|pt)$/)
    if (!m) return null
    const n = parseFloat(m[1])
    if (m[2] === 'pt') return Math.round(n)
    // px → pt (web px are ~0.75pt); rem/em are 16px-based.
    const px = m[2] === 'rem' || m[2] === 'em' ? n * 16 : n
    return Math.round(px * 0.75)
  }
  const typeScalePt = Array.from(
    new Set(ds.tokens.typeScale.map(toPt).filter((n): n is number => n != null && n > 0))
  ).sort((a, b) => b - a)

  return {
    fonts: ds.tokens.fontFamilies,
    palette: ds.tokens.palette,
    colorTokens: ds.tokens.semanticColors,
    typeScalePt,
    logos: ds.tokens.logos,
  }
}

// ── Font loading (@font-face) ──────────────────────────────────────────────────
// Uploaded font binaries must be registered with the browser, otherwise font
// families like "Inter" fall back to the default sans-serif and every option in
// the font picker looks identical.

function fontFormat(filename: string): string {
  const ext = (filename.match(/\.(woff2|woff|ttf|otf|eot)$/i)?.[1] || '').toLowerCase()
  return ext === 'woff2'
    ? 'woff2'
    : ext === 'woff'
      ? 'woff'
      : ext === 'ttf'
        ? 'truetype'
        : ext === 'otf'
          ? 'opentype'
          : ext === 'eot'
            ? 'embedded-opentype'
            : 'woff2'
}

function weightFromName(lower: string): number {
  if (/thin|hairline/.test(lower)) return 100
  if (/extra-?light|ultra-?light/.test(lower)) return 200
  if (/semi-?bold|demi-?bold/.test(lower)) return 600
  if (/extra-?bold|ultra-?bold/.test(lower)) return 800
  if (/black|heavy/.test(lower)) return 900
  if (/medium/.test(lower)) return 500
  if (/bold/.test(lower)) return 700
  if (/light/.test(lower)) return 300
  return 400
}

/** Build @font-face CSS for every uploaded font file that carries its bytes. */
export function buildFontFaceCss(ds: DesignSystem | null): string {
  if (!ds) return ''
  const rules: string[] = []
  for (const f of ds.files) {
    if (f.category !== 'font' || !f.dataUrl) continue
    const family = familyFromFontFile(f.name)
    if (!family) continue
    const lower = f.name.toLowerCase()
    rules.push(
      `@font-face{font-family:"${family}";` +
        `src:url(${f.dataUrl}) format("${fontFormat(f.name)}");` +
        `font-weight:${weightFromName(lower)};` +
        `font-style:${/italic|oblique/.test(lower) ? 'italic' : 'normal'};` +
        `font-display:swap;}`
    )
  }
  return rules.join('\n')
}

// ── Local persistence ────────────────────────────────────────────────────────────
// The uploaded files (incl. font binaries, which can be several MB) are kept in
// IndexedDB so the panel, token preview and on-canvas design tools — and the loaded
// fonts — survive a page reload. The DS knowledge layer is persisted separately via
// the server-side knowledge store.

const DS_STORAGE_KEY = 'pptx-editor:design-system'

/** Per-knowledge-branch storage key so each branch keeps its own design system.
 *  When no branch is given we fall back to the legacy global key. */
function dsStorageKey(scope?: string | null): string {
  return scope ? `${DS_STORAGE_KEY}:${scope}` : DS_STORAGE_KEY
}

interface StoredDS {
  name: string
  files: DSFile[]
}

export async function storeDesignSystem(
  ds: DesignSystem | null,
  scope?: string | null
): Promise<void> {
  if (typeof window === 'undefined') return
  const key = dsStorageKey(scope)
  // Clean up any value left in localStorage by older builds.
  try {
    window.localStorage.removeItem(DS_STORAGE_KEY)
  } catch {
    /* ignore */
  }
  try {
    if (!ds || ds.files.length === 0) {
      await idbDel(key)
    } else {
      await idbSet(key, { name: ds.name, files: ds.files } satisfies StoredDS)
    }
  } catch {
    // Persistence is best-effort.
  }
}

export async function loadStoredDesignSystem(
  id: string,
  scope?: string | null
): Promise<DesignSystem | null> {
  if (typeof window === 'undefined') return null
  try {
    const key = dsStorageKey(scope)
    let stored = await idbGet<StoredDS>(key)
    // Fall back to the legacy global key (pre-branch builds) for a one-time
    // migration so an already-uploaded design system isn't lost.
    if (!stored && scope) {
      stored = await idbGet<StoredDS>(DS_STORAGE_KEY)
    }
    if (!stored) {
      const raw = window.localStorage.getItem(DS_STORAGE_KEY)
      if (raw) stored = JSON.parse(raw) as StoredDS
    }
    const files = stored && Array.isArray(stored.files) ? stored.files : []
    if (files.length === 0) return null
    return buildDesignSystem(id, stored?.name || '', files)
  } catch {
    return null
  }
}

// ── UI helpers ──────────────────────────────────────────────────────────────────

export const DS_TEXT_CATEGORIES: DSCategory[] = ['stylesheet', 'data', 'document']

export function isTextCategory(category: DSCategory): boolean {
  return DS_TEXT_CATEGORIES.includes(category)
}
