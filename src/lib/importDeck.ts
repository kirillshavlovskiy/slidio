import type { ImportResult } from '@/lib/pptxImport'

export const IMPORT_ACCEPT = '.pptx,.pdf'

async function postToImport(file: File): Promise<Response> {
  const form = new FormData()
  form.append('file', file)
  return fetch('/api/import', { method: 'POST', body: form })
}

/**
 * Adobe's PDF→PPTX export keeps editable text but discards the original
 * backgrounds, so every slide comes back white. That makes light/white text
 * (designed for a dark background) invisible. We re-render the source PDF in
 * the browser, sample each page's background colour and apply it to the
 * matching slide while leaving Adobe's text untouched.
 */
async function applyPdfBackgrounds(file: File, result: ImportResult): Promise<ImportResult> {
  try {
    const { samplePdfPageBackgrounds } = await import('@/lib/pdfImport')
    const backgrounds = await samplePdfPageBackgrounds(file)
    const slides = result.slides
    // Adobe normally emits one slide per PDF page; map 1:1 by index and skip
    // gracefully if the counts diverge.
    const count = Math.min(slides.length, backgrounds.length)
    for (let i = 0; i < count; i++) {
      const bg = backgrounds[i]
      if (!bg) continue
      slides[i].bg = bg.hex
      // The recovered background is a flat colour; drop any stale gradient.
      delete slides[i].bgGradient
    }
  } catch {
    // Background recovery is best-effort — keep the text-only result on failure.
  }
  return result
}

/**
 * Import an uploaded presentation file into editable slides.
 *  - .pptx → parsed server-side into real text/shape/image elements.
 *  - .pdf  → converted to PPTX server-side via Adobe PDF Services when
 *            configured; otherwise rendered/extracted in the browser.
 * Legacy binary .ppt is not supported.
 */
export async function importDeckFile(file: File): Promise<ImportResult> {
  const name = file.name.toLowerCase()

  if (name.endsWith('.pptx')) {
    const res = await postToImport(file)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || 'Failed to import PowerPoint file.')
    }
    return res.json()
  }

  if (name.endsWith('.pdf')) {
    // Prefer the server path (Adobe PDF→PPTX → editable elements). If Adobe is
    // not configured or the conversion fails, the route returns 422 with
    // { fallback: 'client-pdf' } and we extract locally with pdf.js.
    try {
      const res = await postToImport(file)
      if (res.ok) {
        const result: ImportResult = await res.json()
        return applyPdfBackgrounds(file, result)
      }
      const body = await res.json().catch(() => ({}))
      if (!body || body.fallback !== 'client-pdf') {
        throw new Error(body.error || 'Failed to import PDF.')
      }
    } catch {
      // Network/parse error reaching the server → try local extraction.
    }
    const { importPdf } = await import('@/lib/pdfImport')
    return importPdf(file)
  }

  if (name.endsWith('.ppt')) {
    throw new Error(
      'Legacy .ppt files are not supported. Please re-save as .pptx or PDF and try again.'
    )
  }

  throw new Error('Unsupported file type. Upload a .pptx or .pdf presentation.')
}
