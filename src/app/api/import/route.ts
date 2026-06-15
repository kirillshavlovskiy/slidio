import { NextRequest, NextResponse } from 'next/server'
import { importPptx } from '@/lib/pptxImport'
import { hasAdobeCredentials, convertPdfToPptx } from '@/lib/adobeExport'

export const runtime = 'nodejs'
// Imported decks (with embedded images) can be large; allow a generous body.
export const maxDuration = 60

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
        const { slides, warnings } = await importPptx(pptx)
        return NextResponse.json({
          slides,
          warnings: ['Converted from PDF via Adobe PDF Services.', ...warnings],
        })
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
