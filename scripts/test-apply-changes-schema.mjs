/**
 * Schema validation test for apply_changes payloads.
 * Runs applyChangesToSlides logic inline against a realistic Phase 2 output
 * to confirm the JSON the model produces is parseable by the platform parser.
 *
 * Run:  node scripts/test-apply-changes-schema.mjs
 */

// ── Inline normalizeElementPatch (mirrors src/lib/preview.ts) ─────────────────
function normalizeElementPatch(existing, patch) {
  const out = { ...patch }
  const xFields = ['x', 'y', 'w', 'h']
  for (const f of xFields) {
    if (out[f] !== undefined) out[f] = Number(out[f])
  }
  if (out.style) {
    const s = { ...out.style }
    if (s.fontSize !== undefined) s.fontSize = Number(s.fontSize)
    if (s.opacity !== undefined) s.opacity = Number(s.opacity)
    if (s.borderRadius !== undefined) s.borderRadius = Number(s.borderRadius)
    if (s.borderWidth !== undefined) s.borderWidth = Number(s.borderWidth)
    out.style = s
  }
  return out
}

function clampIndex(index, length) {
  if (index === undefined || index === null) return undefined
  return Math.max(0, Math.min(Number(index), length))
}

function getDeletedSlideIds(changes) {
  return changes
    .filter(c => c.op === 'delete' && !c.elementId)
    .map(c => c.slideId)
}

// ── Core parser (mirrors src/lib/preview.ts applyChangesToSlides) ─────────────
function applyChangesToSlides(slides, changes) {
  const deletedSlideIds = new Set(getDeletedSlideIds(changes))
  const updated = JSON.parse(JSON.stringify(slides)).filter(
    s => !deletedSlideIds.has(s.id)
  )

  for (const change of changes) {
    if (change.op === 'delete' && !change.elementId) continue

    if (change.op === 'add' && change.slide) {
      const incoming = JSON.parse(JSON.stringify(change.slide))
      incoming.elements = (incoming.elements || []).map(e => normalizeElementPatch(e, e))
      if (!updated.some(s => s.id === incoming.id)) {
        const at = clampIndex(change.index, updated.length) ?? updated.length
        updated.splice(at, 0, incoming)
      }
      continue
    }

    const slide = updated.find(s => s.id === change.slideId)
    if (!slide) continue

    if (change.op === 'add' && change.element) {
      const newEl = normalizeElementPatch(change.element, change.element)
      const existingIdx = slide.elements.findIndex(e => e.id === newEl.id)
      if (existingIdx >= 0) {
        slide.elements[existingIdx] = newEl
      } else {
        const at = clampIndex(change.index, slide.elements.length)
        if (at === undefined) slide.elements.push(newEl)
        else slide.elements.splice(at, 0, newEl)
      }
      continue
    }

    if (change.op === 'reorder' && change.elementId) {
      const from = slide.elements.findIndex(e => e.id === change.elementId)
      if (from >= 0) {
        const [moved] = slide.elements.splice(from, 1)
        const at = clampIndex(change.index, slide.elements.length) ?? slide.elements.length
        slide.elements.splice(at, 0, moved)
      }
      continue
    }

    if (change.elementId) {
      if (change.op === 'delete') {
        slide.elements = slide.elements.filter(e => e.id !== change.elementId)
        continue
      }
      const el = slide.elements.find(e => e.id === change.elementId)
      if (el && change.patch) {
        const patch = normalizeElementPatch(el, change.patch)
        Object.assign(el, { ...patch, style: { ...el.style, ...(patch.style || {}) } })
      }
    } else if (change.slidePatch) {
      Object.assign(slide, change.slidePatch)
    }
  }

  return updated
}

// ── Realistic Phase 2 apply_changes payload (what the model should produce) ───
//
//  Canvas: 10in × 5.625in  (x/y/w/h in inches)
//  Slides are added via op:"add" + slide:{...}
//
const BATCH_1 = {
  summary: 'Slides 1–2: cover + key benefits',
  changes: [
    // ── Slide 1: Cover ────────────────────────────────────────────────────────
    {
      op: 'add',
      slideId: 'slide-cover',        // slideId is required even for add-slide
      slide: {
        id: 'slide-cover',
        bg: '0f172a',               // dark navy (hex, no #)
        bgGradient: {
          type: 'linear',
          angle: 135,
          from: '0f172a',
          to: '1e3a5f',
        },
        elements: [
          {
            id: 'el-cover-logo',
            type: 'text',
            content: 'Slidio',
            x: 0.5, y: 1.8, w: 9, h: 1.2,
            style: {
              fontSize: 72,
              bold: true,
              color: 'ffffff',
              align: 'center',
              fontFace: 'Inter',
            },
          },
          {
            id: 'el-cover-tagline',
            type: 'text',
            content: 'AI-powered presentations',
            x: 0.5, y: 3.1, w: 9, h: 0.7,
            style: {
              fontSize: 28,
              color: '94a3b8',
              align: 'center',
              fontFace: 'Inter',
            },
          },
          {
            id: 'el-cover-year',
            type: 'text',
            content: '2025',
            x: 0.5, y: 4.8, w: 9, h: 0.4,
            style: {
              fontSize: 16,
              color: '64748b',
              align: 'center',
            },
          },
        ],
      },
    },
    // ── Slide 2: Key Benefits ─────────────────────────────────────────────────
    {
      op: 'add',
      slideId: 'slide-benefits',
      slide: {
        id: 'slide-benefits',
        bg: 'ffffff',
        elements: [
          {
            id: 'el-ben-title',
            type: 'text',
            content: 'Key Benefits',
            x: 0.5, y: 0.4, w: 9, h: 0.8,
            style: {
              fontSize: 40,
              bold: true,
              color: '0f172a',
              align: 'left',
              fontFace: 'Inter',
            },
          },
          {
            id: 'el-ben-divider',
            type: 'rect',
            x: 0.5, y: 1.25, w: 2, h: 0.04,
            style: { bg: '3b82f6' },
          },
          {
            id: 'el-ben-b1',
            type: 'text',
            content: '⚡ Speed — build in minutes',
            x: 0.5, y: 1.6, w: 9, h: 0.7,
            style: { fontSize: 24, color: '1e293b', align: 'left' },
          },
          {
            id: 'el-ben-b2',
            type: 'text',
            content: '📈 Scale — handles 50 slides',
            x: 0.5, y: 2.4, w: 9, h: 0.7,
            style: { fontSize: 24, color: '1e293b', align: 'left' },
          },
          {
            id: 'el-ben-b3',
            type: 'text',
            content: '✨ Simplicity — no design skills needed',
            x: 0.5, y: 3.2, w: 9, h: 0.7,
            style: { fontSize: 24, color: '1e293b', align: 'left' },
          },
        ],
      },
    },
  ],
}

const BATCH_2 = {
  summary: 'Slide 3: closing / CTA',
  changes: [
    {
      op: 'add',
      slideId: 'slide-closing',
      slide: {
        id: 'slide-closing',
        bg: '0f172a',
        elements: [
          {
            id: 'el-close-title',
            type: 'text',
            content: 'Next Steps',
            x: 0.5, y: 1.4, w: 9, h: 0.9,
            style: {
              fontSize: 52,
              bold: true,
              color: 'ffffff',
              align: 'center',
              fontFace: 'Inter',
            },
          },
          {
            id: 'el-close-cta',
            type: 'text',
            content: 'Book a demo — contact@slidio.ai',
            x: 0.5, y: 2.6, w: 9, h: 0.7,
            style: {
              fontSize: 26,
              color: '3b82f6',
              align: 'center',
            },
          },
        ],
      },
    },
  ],
}

// ── Run the parser ─────────────────────────────────────────────────────────────
console.log('=== Phase 2 apply_changes schema test ===\n')

let slides = []

console.log(`Input: ${slides.length} slides (empty canvas — clearExisting=true)\n`)

console.log(`Applying batch 1: "${BATCH_1.summary}"`)
slides = applyChangesToSlides(slides, BATCH_1.changes)
console.log(`  → ${slides.length} slide(s) in deck: ${slides.map(s => s.id).join(', ')}`)
slides.forEach(s => {
  console.log(`     • ${s.id}: ${s.elements.length} elements, bg=#${s.bg}`)
})

console.log(`\nApplying batch 2: "${BATCH_2.summary}"`)
slides = applyChangesToSlides(slides, BATCH_2.changes)
console.log(`  → ${slides.length} slide(s) in deck: ${slides.map(s => s.id).join(', ')}`)

console.log('\n=== Final deck ===')
slides.forEach((s, i) => {
  console.log(`\nSlide ${i + 1}: ${s.id}`)
  console.log(`  bg: #${s.bg}${s.bgGradient ? ` (gradient → #${s.bgGradient.to})` : ''}`)
  s.elements.forEach(el => {
    const preview = el.content
      ? ` "${el.content.slice(0, 40)}${el.content.length > 40 ? '…' : ''}"`
      : el.type === 'rect' ? ` [fill=#${el.style.bg}]` : ''
    console.log(`  • [${el.type}] ${el.id}${preview}  @(${el.x},${el.y}) ${el.w}×${el.h}in`)
  })
})

// ── Validate required fields ───────────────────────────────────────────────────
console.log('\n=== Schema validation ===')
let errors = 0

for (const slide of slides) {
  if (!slide.id) { console.error(`  ERROR: slide missing id`); errors++ }
  if (!slide.bg) { console.error(`  ERROR: ${slide.id} missing bg`); errors++ }
  if (!Array.isArray(slide.elements)) { console.error(`  ERROR: ${slide.id} elements not array`); errors++ }
  for (const el of slide.elements) {
    const missing = ['id','type','x','y','w','h','style'].filter(f => el[f] === undefined || el[f] === null)
    if (missing.length) {
      console.error(`  ERROR: ${slide.id}/${el.id} missing required fields: ${missing.join(', ')}`)
      errors++
    }
    if (!['text','rect','chip','bar','image','chart','icon'].includes(el.type)) {
      console.error(`  ERROR: ${slide.id}/${el.id} invalid type "${el.type}"`)
      errors++
    }
    for (const dim of ['x','y','w','h']) {
      if (typeof el[dim] !== 'number') {
        console.error(`  ERROR: ${slide.id}/${el.id} ${dim} must be number, got ${typeof el[dim]}`)
        errors++
      }
    }
  }
}

if (errors === 0) {
  console.log(`  ALL GOOD — ${slides.length} slides, ${slides.reduce((n,s)=>n+s.elements.length,0)} total elements, 0 schema errors`)
} else {
  console.error(`  FAILED — ${errors} error(s)`)
  process.exit(1)
}

console.log('\n=== JSON payload that apply_changes tool would send ===')
console.log(JSON.stringify({ changes: BATCH_1.changes, summary: BATCH_1.summary }, null, 2).slice(0, 800) + '\n  … (truncated)')
