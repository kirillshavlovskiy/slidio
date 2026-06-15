import { Readable } from 'stream'

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
    MimeType,
    ExportPDFParams,
    ExportPDFTargetFormat,
    ExportPDFJob,
    ExportPDFResult,
  } = await import('@adobe/pdfservices-node-sdk')

  const credentials = new ServicePrincipalCredentials({ clientId, clientSecret })
  const pdfServices = new PDFServices({ credentials })

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
