import { SlideData, SlideElement } from '@/lib/types'

/** A single OCR'd text run with its bounding box (PDF points, bottom-left origin). */
export interface OcrTextItem {
  page: number
  text: string
  bounds: [number, number, number, number] // [x0, y0, x1, y1]
  size?: number // font size in points, if known
  bold?: boolean
}

export interface OcrResult {
  pages: { width: number; height: number }[] // per-page size in points
  items: OcrTextItem[]
}

let seq = 0
const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Replace image-only slides with editable text recovered by Adobe Extract.
 *
 * The page picture has the text *baked into it*, so keeping that image AND
 * adding text boxes would show every word twice (one non-editable, one
 * editable). To avoid that we drop the full-page background image and keep only
 * the editable text; the slide's solid background colour (sampled separately on
 * the client) stands in for the original artwork. Text is positioned as a
 * fraction of where the page image used to sit. Slide order is assumed to match
 * PDF page order (1 slide per page).
 */
export function mergeOcrTextIntoSlides(slides: SlideData[], ocr: OcrResult): SlideData[] {
  slides.forEach((slide, i) => {
    const page = ocr.pages[i]
    if (!page?.width || !page?.height) return
    // Leave pages that already have a real text layer untouched (no doubling).
    if (slide.elements.some(e => e.type === 'text' && (e.content || '').trim())) return

    // Reference rect = the full-page image (largest image), else the canvas.
    let rect = { x: 0, y: 0, w: 10, h: 7.5 }
    let pageImage: SlideElement | undefined
    const imgs = slide.elements.filter(e => e.type === 'image')
    if (imgs.length) {
      pageImage = imgs.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b))
      rect = { x: pageImage.x, y: pageImage.y, w: pageImage.w, h: pageImage.h }
    }
    // points → editor font points (the page is displayed at rect.w inches).
    const fontScale = (72 * rect.w) / page.width

    const textEls: SlideElement[] = []
    for (const it of ocr.items) {
      if (it.page !== i) continue
      const text = it.text.trim()
      if (!text) continue
      const [x0, y0, x1, y1] = it.bounds
      const bw = x1 - x0
      const bh = y1 - y0
      if (bw <= 0 || bh <= 0) continue
      // Skip whole-page container blocks (they duplicate everything at 0,0).
      if (bw >= page.width * 0.97 && bh >= page.height * 0.97) continue

      const elX = rect.x + (x0 / page.width) * rect.w
      // PDF y is bottom-left; flip to a top-left offset.
      const elY = rect.y + ((page.height - y1) / page.height) * rect.h
      const elW = Math.max(0.3, (bw / page.width) * rect.w)
      const elH = Math.max(0.2, (bh / page.height) * rect.h)
      const fontSize = Math.max(6, Math.round((it.size ?? bh * 0.7) * fontScale))

      seq += 1
      textEls.push({
        id: `ocr-${i}-${seq}`,
        type: 'text',
        content: text,
        x: r2(elX),
        y: r2(elY),
        w: r2(elW),
        h: r2(elH),
        style: { fontSize, color: 'FFFFFF', valign: 'top', ...(it.bold ? { bold: true } : {}) },
      } as SlideElement)
    }

    // Only swap the page image out for text if we actually recovered some text;
    // otherwise leave the image so the slide isn't left blank.
    if (textEls.length > 0 && pageImage) {
      slide.elements = slide.elements.filter(e => e !== pageImage)
    }
    slide.elements.push(...textEls)
  })
  return slides
}
