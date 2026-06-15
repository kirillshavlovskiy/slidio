import { NextRequest, NextResponse } from 'next/server'
import { importPptx } from '@/lib/pptxImport'
import { hasAdobeCredentials, convertPdfToPptx, extractPdfText } from '@/lib/adobeExport'
import { mergeOcrTextIntoSlides } from '@/lib/ocrMerge'

export const runtime = 'nodejs'
// Large PDFs (tens of MB) can take a while to upload + convert via Adobe — and
// image-only PDFs need a second OCR pass — so allow a generous duration
// (hosting plan limits still apply in production).
export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const lower = file.name.toLowerCase()
    const buffer = Buffer.from(await file.arrayBuffer())

    // ── PDF: convert to PPTX via Adobe PDF Services, then parse as PPTX ─────────
    if (lower.endsWith('.pdf')) {
      if (!hasAdobeCredentials()) {
        // No Adobe creds → tell the client to use its local pdf.js extractor.
        return NextResponse.json(
          { fallback: 'client-pdf', reason: 'adobe-not-configured' },
          { status: 422 }
        )
      }
      try {
        const pptx = await convertPdfToPptx(buffer)
        const parsed = await importPptx(pptx)
        let slides = parsed.slides
        const warnings = ['Converted from PDF via Adobe PDF Services.', ...parsed.warnings]
        let ocr = false

        // Image-only / flattened pages come back as a picture with no text.
        // If ANY page lacks text, run Adobe Extract (which OCRs) and overlay
        // editable text — but only onto the pages that have none, so pages with
        // a real text layer keep their original text.
        const slideHasText = (s: (typeof slides)[number]) =>
          s.elements.some(e => e.type === 'text' && (e.content || '').trim())
        const needsOcr = slides.some(s => !slideHasText(s))
        if (needsOcr) {
          try {
            const extracted = await extractPdfText(buffer)
            if (extracted.items.length > 0) {
              slides = mergeOcrTextIntoSlides(slides, extracted)
              ocr = true
              warnings.push(
                'This PDF had no selectable text (each page is an image). Text was recovered with Adobe OCR and added as editable text boxes — positions and spelling may be approximate.'
              )
            }
          } catch (ocrErr) {
            console.error('Adobe OCR text extraction failed:', ocrErr)
          }
        }

        return NextResponse.json({ slides, warnings, ocr })
      } catch (err) {
        console.error('Adobe PDF→PPTX conversion failed:', err)
        // Conversion failed (quota, bad PDF, network) → fall back client-side.
        return NextResponse.json(
          { fallback: 'client-pdf', reason: 'adobe-failed' },
          { status: 422 }
        )
      }
    }

    if (!lower.endsWith('.pptx')) {
      return NextResponse.json(
        { error: 'Only .pptx or .pdf files are supported.' },
        { status: 400 }
      )
    }

    const { slides, warnings } = await importPptx(buffer)
    return NextResponse.json({ slides, warnings })
  } catch (err) {
    console.error('import error:', err)
    const message = err instanceof Error ? err.message : 'Failed to import presentation'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
