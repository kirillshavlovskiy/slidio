import { NextRequest, NextResponse } from 'next/server'
import { SlideData, ElementStyle, ChartSpec, ChartSeries } from '@/lib/types'
import { elementFillHex, elementTextHex } from '@/lib/elementStyle'
import { SLIDE_W_IN, SLIDE_H_IN } from '@/lib/layout'

// ── Unit helpers ────────────────────────────────────────────────────────────
// Canvas styles mix units; PPTX wants inches (geometry), points (line width,
// text margins) and percentages (transparency). 96px = 1in; 72pt = 1in.
const PX_PER_IN = 96
const PT_PER_IN = 72
const pxToPt = (px: number) => (px * PT_PER_IN) / PX_PER_IN
const pxToIn = (px: number) => px / PX_PER_IN
const inToPt = (inches: number) => inches * PT_PER_IN

const DASH_TYPE: Record<string, string> = { solid: 'solid', dashed: 'dash', dotted: 'sysDot' }

/** opacity (0–100, default 100) → pptxgenjs transparency (0 = opaque). */
function transparencyOf(st: ElementStyle): number | undefined {
  if (typeof st.opacity !== 'number' || st.opacity >= 100) return undefined
  return Math.round(100 - Math.max(0, st.opacity))
}

/** A pptxgenjs line spec from the element border style ('none' = no outline). */
function lineOf(st: ElementStyle): Record<string, unknown> {
  if (st.borderWidth && st.borderWidth > 0 && st.borderColor) {
    return {
      color: st.borderColor,
      width: pxToPt(st.borderWidth),
      dashType: DASH_TYPE[st.borderStyle || 'solid'] || 'solid',
    }
  }
  return { type: 'none' }
}

/** Text inner margins [top, right, bottom, left] in points from inch padding. */
function marginOf(st: ElementStyle): number | [number, number, number, number] {
  const { padTop, padRight, padBottom, padLeft } = st
  if (padTop == null && padRight == null && padBottom == null && padLeft == null) return 0
  return [inToPt(padTop || 0), inToPt(padRight || 0), inToPt(padBottom || 0), inToPt(padLeft || 0)]
}

/** Decode a base64 data URL to a Buffer (returns null for non-base64 / remote URLs). */
function dataUrlToBuffer(src: string): Buffer | null {
  const m = /^data:[^;,]*;base64,(.*)$/is.exec(src)
  if (!m) return null
  try {
    return Buffer.from(m[1], 'base64')
  } catch {
    return null
  }
}

/**
 * Read an image's intrinsic pixel dimensions from its header. Supports PNG, JPEG,
 * GIF and WEBP — enough to fit logos correctly. Returns null if unknown so the
 * caller can fall back to pptxgenjs sizing.
 */
function intrinsicSize(buf: Buffer): { w: number; h: number } | null {
  // PNG: 8-byte sig, then IHDR (width @16, height @20, big-endian).
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  }
  // GIF: "GIF", then logical screen width/height (little-endian @6/@8).
  if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) }
  }
  // WEBP: RIFF....WEBP
  if (
    buf.length >= 30 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const fmt = buf.toString('ascii', 12, 16)
    if (fmt === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) }
    if (fmt === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
    if (fmt === 'VP8L') {
      const b = buf.readUInt32LE(21)
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }
    }
  }
  // JPEG: scan segments for a Start-Of-Frame marker carrying the dimensions.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off++
        continue
      }
      const marker = buf[off + 1]
      const isSOF =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSOF) return { w: buf.readUInt16BE(off + 7), h: buf.readUInt16BE(off + 5) }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        off += 2
        continue
      }
      off += 2 + buf.readUInt16BE(off + 2)
    }
  }
  return null
}

const CHART_PALETTE = [
  '60A5FA', '34D399', 'FBBF24', 'F87171', 'A78BFA', '22D3EE', 'FB7185', 'A3E635',
]

/** Render a ChartSpec as a NATIVE (editable) pptxgenjs chart at inch coords. */
function addChartToSlide(
  pptxgen: typeof import('pptxgenjs').default,
  slide: ReturnType<InstanceType<typeof import('pptxgenjs').default>['addSlide']>,
  x: number,
  y: number,
  w: number,
  h: number,
  spec: ChartSpec
) {
  const categories = spec.categories || []
  const series = spec.series || []
  if (!categories.length || !series.length) return

  const showLegend = spec.showLegend ?? series.length > 1
  const isPie = spec.type === 'pie' || spec.type === 'donut'

  const xTitle = spec.xAxisTitle?.trim()
  const yTitle = spec.yAxisTitle?.trim()
  const y2Title = spec.y2AxisTitle?.trim()

  const common: Record<string, unknown> = {
    x, y, w, h,
    showLegend,
    legendPos: 'b',
    showTitle: !!spec.title,
    ...(spec.title ? { title: spec.title, titleColor: '94A3B8', titleFontSize: 13 } : {}),
    showValue: !!spec.showValues,
    catAxisLabelColor: 'CBD5E1',
    valAxisLabelColor: 'CBD5E1',
    dataLabelColor: 'CBD5E1',
    // Axis titles (units live here). Ignored by pie/donut.
    ...(xTitle ? { showCatAxisTitle: true, catAxisTitle: xTitle, catAxisTitleColor: '94A3B8' } : {}),
    ...(yTitle ? { showValAxisTitle: true, valAxisTitle: yTitle, valAxisTitleColor: '94A3B8' } : {}),
  }

  if (isPie) {
    const data = [{ name: series[0].name, labels: categories, values: series[0].values || [] }]
    slide.addChart(spec.type === 'donut' ? pptxgen.ChartType.doughnut : pptxgen.ChartType.pie, data, {
      ...common,
      chartColors: categories.map((_, i) =>
        (spec.palette?.[i] || CHART_PALETTE[i % CHART_PALETTE.length]).replace('#', '')
      ),
      ...(spec.type === 'donut' ? { holeSize: 55 } : {}),
      showPercent: spec.showValues,
    })
    return
  }

  const colorFor = (sr: ChartSeries, i: number) =>
    (sr.color || spec.palette?.[i] || CHART_PALETTE[i % CHART_PALETTE.length]).replace('#', '')

  const seriesPptxType = (t: string | undefined): 'bar' | 'line' | 'area' =>
    t === 'line' ? 'line' : t === 'area' ? 'area' : 'bar'

  // ── Combo (mixed bar/line/area, optional secondary value axis) ──────────────
  if (spec.type === 'combo') {
    const hasRight = series.some(sr => sr.axis === 'right')
    // One chart-type entry per series so each can carry its own type + axis.
    const chartTypes = series.map((sr, i) => {
      const st = seriesPptxType(sr.type)
      return {
        type: st,
        data: [{ name: sr.name, labels: categories, values: sr.values || [] }],
        options: {
          chartColors: [colorFor(sr, i)],
          ...(st === 'bar' ? { barDir: 'col' as const } : {}),
          ...(hasRight && sr.axis === 'right'
            ? { secondaryValAxis: true, secondaryCatAxis: true }
            : {}),
        },
      }
    })
    const comboOpts: Record<string, unknown> = {
      ...common,
      // Dual axes only when a series is assigned to the right; pptxgenjs needs both
      // a primary and secondary entry in valAxes/catAxes for the secondary to show.
      ...(hasRight
        ? {
            valAxes: [
              {
                valAxisLabelColor: 'CBD5E1',
                ...(yTitle ? { showValAxisTitle: true, valAxisTitle: yTitle, valAxisTitleColor: '94A3B8' } : { showValAxisTitle: false }),
              },
              {
                valAxisLabelColor: 'CBD5E1',
                ...(y2Title ? { showValAxisTitle: true, valAxisTitle: y2Title, valAxisTitleColor: '94A3B8' } : { showValAxisTitle: false }),
              },
            ],
            catAxes: [{ catAxisLabelColor: 'CBD5E1' }, { catAxisHidden: true }],
          }
        : {}),
    }
    // Multi-type form: pptxgenjs reads options from the 2nd arg (tmpOpt = data || opt).
    // The published d.ts types the 2nd param as any[], so cast to call the real 2-arg form.
    ;(slide.addChart as unknown as (t: typeof chartTypes, o: Record<string, unknown>) => void)(
      chartTypes,
      comboOpts
    )
    return
  }

  const data = series.map(sr => ({
    name: sr.name,
    labels: categories,
    values: sr.values || [],
  }))
  const chartColors = series.map((sr, i) => colorFor(sr, i))

  const type =
    spec.type === 'line'
      ? pptxgen.ChartType.line
      : spec.type === 'area'
        ? pptxgen.ChartType.area
        : pptxgen.ChartType.bar

  slide.addChart(type, data, {
    ...common,
    chartColors,
    ...(spec.type === 'bar' ? { barDir: 'col' as const } : {}),
    ...(spec.stacked && (spec.type === 'bar' || spec.type === 'area')
      ? { barGrouping: 'stacked' as const }
      : {}),
  })
}

export async function POST(req: NextRequest) {
  const { slides } = await req.json() as { slides: SlideData[] }

  // pptxgenjs must be imported dynamically (server only)
  const pptxgen = (await import('pptxgenjs')).default
  const pres = new pptxgen()
  // The editor canvas (960×720 px) and all element geometry use a 10 × 7.5 in
  // (4:3) coordinate space. Define a matching page so the export looks identical —
  // NOT the default LAYOUT_16x9 (10 × 5.625 in), which squashes a 4:3 deck onto a
  // 16:9 page and pushes the bottom third off-slide.
  pres.defineLayout({ name: 'EDITOR', width: SLIDE_W_IN, height: SLIDE_H_IN })
  pres.layout = 'EDITOR'

  for (const slide of slides) {
    const s = pres.addSlide()
    s.background = { color: slide.bg }

    for (const el of slide.elements) {
      const st = el.style ?? {}
      const fill = elementFillHex(el) || (el.type === 'bar' ? '60A5FA' : '112236')
      const transparency = transparencyOf(st)
      const fillSpec = { color: fill, ...(transparency != null ? { transparency } : {}) }

      if (el.type === 'bar') {
        s.addShape(pptxgen.ShapeType.rect, {
          x: el.x, y: el.y, w: el.w, h: el.h,
          fill: fillSpec,
          line: lineOf(st),
        })
      } else if (el.type === 'rect' || el.type === 'chip') {
        // Rounded corners → use a round-rect shape (rectRadius is in inches).
        const radius = st.borderRadius && st.borderRadius > 0 ? pxToIn(st.borderRadius) : 0
        const shapeType = radius > 0 ? pptxgen.ShapeType.roundRect : pptxgen.ShapeType.rect
        s.addShape(shapeType, {
          x: el.x, y: el.y, w: el.w, h: el.h,
          fill: fillSpec,
          line: lineOf(st),
          ...(radius > 0 ? { rectRadius: radius } : {}),
        })
        if (el.content) {
          s.addText(el.content, {
            x: el.x, y: el.y, w: el.w, h: el.h,
            fontSize: st.fontSize || 10,
            bold: st.bold,
            color: elementTextHex(el),
            align: (st.align as any) || 'center',
            valign: (st.valign as any) || 'middle',
            fontFace: st.fontFace || 'Calibri',
            charSpacing: st.charSpacing,
            margin: marginOf(st),
          })
        }
      } else if (el.type === 'image') {
        // Skip unresolved name references (e.g. "logo:Deel") — only real data/URL
        // sources can be embedded in the PPTX.
        const isRealSrc = !!el.src && /^(data:|https?:|blob:)/i.test(el.src)
        if (isRealSrc) {
          // Editor default is objectFit:contain (aspect preserved), so match it.
          const fit = el.style?.objectFit ?? 'contain'
          const alpha = transparency != null ? { transparency } : {}

          if (fit === 'fill') {
            // Stretch to the box (the only mode that intentionally distorts).
            s.addImage({ data: el.src, x: el.x, y: el.y, w: el.w, h: el.h, ...alpha })
          } else if (fit === 'cover') {
            s.addImage({
              data: el.src,
              x: el.x, y: el.y, w: el.w, h: el.h,
              sizing: { type: 'cover', w: el.w, h: el.h },
              ...alpha,
            })
          } else {
            // CONTAIN: pptxgenjs can't read a data-URL's intrinsic size server-side,
            // so its "contain" silently stretches (squeezed logos). Compute the
            // aspect-correct box ourselves from the image header and center it.
            const buf = el.src ? dataUrlToBuffer(el.src) : null
            const dim = buf ? intrinsicSize(buf) : null
            if (dim && dim.w > 0 && dim.h > 0) {
              const arImg = dim.w / dim.h
              const arBox = el.w / el.h
              let drawW = el.w
              let drawH = el.h
              if (arImg > arBox) drawH = el.w / arImg
              else drawW = el.h * arImg
              s.addImage({
                data: el.src,
                x: el.x + (el.w - drawW) / 2,
                y: el.y + (el.h - drawH) / 2,
                w: drawW,
                h: drawH,
                ...alpha,
              })
            } else {
              // Unknown format — fall back to pptxgenjs contain.
              s.addImage({
                data: el.src,
                x: el.x, y: el.y, w: el.w, h: el.h,
                sizing: { type: 'contain', w: el.w, h: el.h },
                ...alpha,
              })
            }
          }
        }
      } else if (el.type === 'chart' && el.chart) {
        addChartToSlide(pptxgen, s, el.x, el.y, el.w, el.h, el.chart)
      } else {
        // text
        if (el.content) {
          s.addText(el.content, {
            x: el.x, y: el.y, w: el.w, h: el.h,
            fontSize: st.fontSize || 12,
            bold: st.bold,
            italic: st.italic,
            color: elementTextHex(el),
            align: (st.align as any) || 'left',
            valign: (st.valign as any) || 'middle',
            fontFace: st.fontFace || 'Calibri',
            charSpacing: st.charSpacing,
            // Keep a text-row background (e.g. zebra striping) in the export.
            ...(st.bg ? { fill: { color: st.bg, ...(transparency != null ? { transparency } : {}) } } : {}),
            // Carry a real border onto the text box when one is set.
            ...(st.borderWidth && st.borderWidth > 0 && st.borderColor ? { line: lineOf(st) } : {}),
            margin: marginOf(st),
          })
        }
      }
    }
  }

  const buffer = await pres.write({ outputType: 'nodebuffer' }) as Buffer
  // Wrap in Uint8Array so it satisfies BodyInit (Buffer alone isn't assignable).
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="presentation.pptx"',
    },
  })
}
