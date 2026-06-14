// Unified media/asset library. Generalizes the design-system "logo" reference
// mechanism to ANY image asset — user-uploaded buffers, images already placed in
// the deck, and design-system logos. The model can't emit image bytes, so it
// references an asset by name (e.g. src="image:hero" / "logo:Deel"); the client
// swaps in the real data URL via resolveAssetRefs() before applying changes.

import type { Change, SlideData } from './types'
import type { DSLogo } from './designSystem'
import { idbGet, idbSet } from './dsStorage'

export type MediaKind = 'logo' | 'image'

export interface MediaAsset {
  id: string
  name: string
  src: string // data URL (or any resolvable image URL)
  kind: MediaKind
}

const STORE_KEY = 'pptx:media-library'

// Reference prefixes the model may use, all treated equivalently.
const REF_RE = /^@?(asset|image|img|media|logo|photo|pic|icon)\s*:/i

/** Normalize a name (drop extension, lowercase, separators → spaces). */
function normName(n: string): string {
  return n
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[\s_\-/]+/g, ' ')
    .trim()
}
/** Split a name into word tokens, also breaking camelCase (DeelLogoBlack → deel logo black). */
function tokensOf(n: string): string[] {
  return normName(n.replace(/([a-z])([A-Z])/g, '$1 $2'))
    .split(' ')
    .filter(Boolean)
}

export function isAssetRef(s: unknown): s is string {
  return typeof s === 'string' && REF_RE.test(s)
}

/**
 * Find the best-matching asset for a "kind:name" reference using token overlap,
 * so guessed names like "DeelLogoBlack" still match "deel-wordmark-black.png".
 */
function matchAsset(ref: string, assets: MediaAsset[]): MediaAsset | undefined {
  const wantKind = (ref.match(REF_RE)?.[1] ?? '').toLowerCase()
  const refTokens = tokensOf(ref.replace(REF_RE, ''))
  const refTight = refTokens.join('')
  // Prefer assets whose kind matches the prefix when the prefix is logo-specific.
  const pool =
    wantKind === 'logo' && assets.some(a => a.kind === 'logo')
      ? assets.filter(a => a.kind === 'logo')
      : assets
  if (refTokens.length === 0) return pool[0] ?? assets[0]

  const score = (a: MediaAsset): number => {
    const at = tokensOf(a.name)
    const atTight = at.join('')
    if (atTight === refTight) return 1000
    let sc = 0
    for (const t of refTokens) if (at.includes(t)) sc += 3
    if (atTight.includes(refTight) || refTight.includes(atTight)) sc += 4
    for (const t of refTokens) for (const u of at) if (u.includes(t) || t.includes(u)) sc += 1
    return sc
  }

  const pick = (list: MediaAsset[]): MediaAsset | undefined => {
    let best: MediaAsset | undefined
    let bestScore = 0
    for (const a of list) {
      const sc = score(a)
      if (sc > bestScore) {
        bestScore = sc
        best = a
      }
    }
    return bestScore > 0 ? best : undefined
  }

  return pick(pool) ?? pick(assets)
}

/** Resolve a single image reference string to a real asset src, or null if no match. */
export function resolveSrc(src: string | undefined, assets: MediaAsset[]): string | null {
  if (!isAssetRef(src) || assets.length === 0) return null
  return matchAsset(src, assets)?.src ?? null
}

/**
 * Replace `image:/img:/media:/logo:/asset:<name>` references on any image element
 * (in `op:add` element or `op:update` patch) with the real asset data URL.
 */
export function resolveAssetRefs(changes: Change[], assets: MediaAsset[]): Change[] {
  if (!Array.isArray(changes) || assets.length === 0) return changes
  return changes.map(c => {
    let next = c
    if (c.element && isAssetRef(c.element.src)) {
      const hit = matchAsset(c.element.src as string, assets)
      if (hit) next = { ...next, element: { ...c.element, type: 'image', src: hit.src } }
    }
    const patchSrc = (c.patch as { src?: unknown } | undefined)?.src
    if (c.patch && isAssetRef(patchSrc)) {
      const hit = matchAsset(patchSrc as string, assets)
      if (hit) next = { ...next, patch: { ...c.patch, src: hit.src } }
    }
    return next
  })
}

/** List any image references in the changes that could NOT be resolved to a real asset. */
export function unresolvedRefs(changes: Change[]): string[] {
  const out: string[] = []
  for (const c of changes) {
    const s = c.element?.src
    if (isAssetRef(s)) out.push(s as string)
    const ps = (c.patch as { src?: unknown } | undefined)?.src
    if (isAssetRef(ps)) out.push(ps as string)
  }
  return out
}

/** Build the asset list the resolver/AI use: design-system logos + media library + deck images. */
export function collectAssets(
  logos: DSLogo[],
  library: MediaAsset[],
  slides: SlideData[]
): MediaAsset[] {
  const out: MediaAsset[] = []
  const seenSrc = new Set<string>()
  const push = (a: MediaAsset) => {
    if (!a.src || seenSrc.has(a.src)) return
    seenSrc.add(a.src)
    out.push(a)
  }
  for (const l of logos) push({ id: `logo:${l.name}`, name: l.name, src: l.src, kind: 'logo' })
  for (const m of library) push(m)
  // Images already on slides become referenceable by their element id.
  for (const s of slides) {
    for (const el of s.elements) {
      if (el.type === 'image' && el.src && !el.src.startsWith('logo:')) {
        push({ id: el.id, name: el.id, src: el.src, kind: 'image' })
      }
    }
  }
  return out
}

/** Compact manifest (names + kinds, NO data URLs) to hand the model so it knows what's available. */
export function mediaManifest(assets: MediaAsset[]): { name: string; kind: MediaKind }[] {
  return assets.map(a => ({ name: a.name, kind: a.kind }))
}

/** Human-readable block injected into the AI context describing available media + ref syntax. */
export function buildMediaContext(assets: { name: string; kind: MediaKind }[]): string {
  if (!assets.length) return ''
  const lines = assets.map(a => `  - ${a.name} (${a.kind})`).join('\n')
  return `MEDIA LIBRARY (available images you can place — reference by name, NEVER type as text):
${lines}
To place one, add an IMAGE element with src="image:<NAME>" (or "logo:<NAME>" for logos) using a name above.
Example: { op:"add", element:{ id:"<unique>", type:"image", src:"image:${assets[0].name}", x, y, w, h, style:{ objectFit:"contain" } } }.
The app swaps the reference for the real image. Place it where it does NOT overlap existing titles/content; set style.invert=true if its colors clash with the slide background.`
}

// ── Persistence ──────────────────────────────────────────────────────────────

export async function storeMediaLibrary(library: MediaAsset[]): Promise<void> {
  try {
    await idbSet(STORE_KEY, library)
  } catch {
    /* ignore quota / unavailable */
  }
}

export async function loadMediaLibrary(): Promise<MediaAsset[]> {
  try {
    const v = await idbGet<MediaAsset[]>(STORE_KEY)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

let counter = 0
export function makeAssetId(): string {
  counter += 1
  return `media-${Date.now().toString(36)}-${counter}`
}

/** Derive a clean asset name from a filename, falling back to a sequential default. */
export function assetNameFromFile(fileName: string | undefined, existing: MediaAsset[]): string {
  const base = (fileName ?? '').replace(/\.[a-z0-9]+$/i, '').trim()
  if (base) {
    let name = base
    let i = 2
    const taken = new Set(existing.map(a => a.name.toLowerCase()))
    while (taken.has(name.toLowerCase())) name = `${base} ${i++}`
    return name
  }
  return `image ${existing.length + 1}`
}
