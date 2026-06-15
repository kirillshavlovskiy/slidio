import { Readable } from 'stream'
import type { OcrResult, OcrTextItem } from '@/lib/ocrMerge'

/** True when Adobe PDF Services credentials are configured in the environment. */
export function hasAdobeCredentials(): boolean {
  return Boolean(
    (process.env.PDF_SERVICES_CLIENT_ID || process.env.ADOBE_CLIENT_ID) &&
      (process.env.PDF_SERVICES_CLIENT_SECRET || process.env.ADOBE_CLIENT_SECRET)
  )
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

/**
 * Convert a PDF (Buffer) to a PowerPoint (.pptx) Buffer using Adobe PDF
 * Services "Export PDF". Throws if credentials are missing or the job fails;
 * callers should fall back to local extraction on error.
 */
export async function convertPdfToPptx(buffer: Buffer): Promise<Buffer> {
  const clientId = process.env.PDF_SERVICES_CLIENT_ID || process.env.ADOBE_CLIENT_ID
  const clientSecret =
    process.env.PDF_SERVICES_CLIENT_SECRET || process.env.ADOBE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('Adobe PDF Services credentials are not configured.')
  }

  const {
    ServicePrincipalCredentials,
    PDFServices,
    ClientConfig,
    MimeType,
    ExportPDFParams,
    ExportPDFTargetFormat,
    ExportPDFJob,
    ExportPDFResult,
  } = await import('@adobe/pdfservices-node-sdk')

  const credentials = new ServicePrincipalCredentials({ clientId, clientSecret })
  // The SDK defaults to a 10s per-request timeout, which large PDFs (tens of MB)
  // blow past while uploading — causing a false failure and an image-only
  // fallback. Give uploads/polling much more room (override via env if needed).
  const timeout = Number(process.env.ADOBE_TIMEOUT_MS) || 180000
  const clientConfig = new ClientConfig({ timeout })
  const pdfServices = new PDFServices({ credentials, clientConfig })

  const inputAsset = await pdfServices.upload({
    readStream: Readable.from(buffer),
    mimeType: MimeType.PDF,
  })

  const params = new ExportPDFParams({ targetFormat: ExportPDFTargetFormat.PPTX })
  const job = new ExportPDFJob({ inputAsset, params })

  const pollingURL = await pdfServices.submit({ job })
  const response = await pdfServices.getJobResult({
    pollingURL,
    resultType: ExportPDFResult,
  })

  if (!response.result) throw new Error('Adobe export returned no result')
  const resultAsset = response.result.asset
  const streamAsset = await pdfServices.getContent({ asset: resultAsset })
  return streamToBuffer(streamAsset.readStream as NodeJS.ReadableStream)
}

/**
 * Extract text (with positions) from a PDF using Adobe PDF Services "Extract".
 * Unlike Export, Extract auto-OCRs image-only / scanned PDFs, so this is how we
 * recover editable text from decks that were flattened to one image per page.
 * Returns per-page dimensions (points) and text items with bounding boxes.
 */
export async function extractPdfText(buffer: Buffer): Promise<OcrResult> {
  const clientId = process.env.PDF_SERVICES_CLIENT_ID || process.env.ADOBE_CLIENT_ID
  const clientSecret =
    process.env.PDF_SERVICES_CLIENT_SECRET || process.env.ADOBE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('Adobe PDF Services credentials are not configured.')
  }

  const {
    ServicePrincipalCredentials,
    PDFServices,
    ClientConfig,
    MimeType,
    ExtractPDFParams,
    ExtractElementType,
    ExtractPDFJob,
    ExtractPDFResult,
  } = await import('@adobe/pdfservices-node-sdk')

  const credentials = new ServicePrincipalCredentials({ clientId, clientSecret })
  const timeout = Number(process.env.ADOBE_TIMEOUT_MS) || 180000
  const clientConfig = new ClientConfig({ timeout })
  const pdfServices = new PDFServices({ credentials, clientConfig })

  const inputAsset = await pdfServices.upload({
    readStream: Readable.from(buffer),
    mimeType: MimeType.PDF,
  })
  const params = new ExtractPDFParams({ elementsToExtract: [ExtractElementType.TEXT] })
  const job = new ExtractPDFJob({ inputAsset, params })
  const pollingURL = await pdfServices.submit({ job })
  const response = await pdfServices.getJobResult({ pollingURL, resultType: ExtractPDFResult })
  if (!response.result) throw new Error('Adobe extract returned no result')

  const streamAsset = await pdfServices.getContent({ asset: response.result.resource })
  const zipBuf = await streamToBuffer(streamAsset.readStream as NodeJS.ReadableStream)
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(zipBuf)
  const dataFile = zip.file('structuredData.json')
  if (!dataFile) throw new Error('Adobe extract result missing structuredData.json')
  const json = JSON.parse(await dataFile.async('text'))

  const pages: OcrResult['pages'] = (json.pages || []).map(
    (p: { width?: number; height?: number }) => ({ width: p.width || 0, height: p.height || 0 })
  )
  const items: OcrTextItem[] = []
  for (const el of json.elements || []) {
    if (typeof el.Text !== 'string' || !el.Text.trim()) continue
    if (!Array.isArray(el.Bounds) || el.Bounds.length < 4) continue
    items.push({
      page: typeof el.Page === 'number' ? el.Page : 0,
      text: el.Text,
      bounds: [el.Bounds[0], el.Bounds[1], el.Bounds[2], el.Bounds[3]],
      size: typeof el.TextSize === 'number' ? el.TextSize : undefined,
      bold: el.Font?.weight ? el.Font.weight >= 700 : undefined,
    })
  }
  return { pages, items }
}
