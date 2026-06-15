import fs from 'node:fs'
import { Readable } from 'node:stream'
import JSZip from 'jszip'
import {
  ServicePrincipalCredentials, PDFServices, MimeType,
  ExportPDFParams, ExportPDFTargetFormat, ExportPDFJob, ExportPDFResult,
} from '@adobe/pdfservices-node-sdk'

const env = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?\s*$/); if (m) env[m[1]] = m[2]
}
const credentials = new ServicePrincipalCredentials({
  clientId: env.PDF_SERVICES_CLIENT_ID, clientSecret: env.PDF_SERVICES_CLIENT_SECRET,
})
const pdfBuffer = fs.readFileSync('/Users/kirillshavlovskiy/Downloads/FireWallets.pdf')
const pdfServices = new PDFServices({ credentials })
const inputAsset = await pdfServices.upload({ readStream: Readable.from(pdfBuffer), mimeType: MimeType.PDF })
const job = new ExportPDFJob({ inputAsset, params: new ExportPDFParams({ targetFormat: ExportPDFTargetFormat.PPTX }) })
const pollingURL = await pdfServices.submit({ job })
const response = await pdfServices.getJobResult({ pollingURL, resultType: ExportPDFResult })
const streamAsset = await pdfServices.getContent({ asset: response.result.asset })
const chunks = []; for await (const c of streamAsset.readStream) chunks.push(c)
const pptx = Buffer.concat(chunks)
fs.writeFileSync('/tmp/firewallets.pptx', pptx)
console.log('PPTX bytes:', pptx.length)

const zip = await JSZip.loadAsync(pptx)
const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>(+a.match(/\d+/))-(+b.match(/\d+/)))
console.log('slide count:', slides.length)
for (const s of slides.slice(0, 4)) {
  const x = await zip.file(s).async('text')
  const c=(re)=>(x.match(re)||[]).length
  console.log('\n==', s.replace('ppt/slides/',''), 'len', x.length, 'sp',c(/<p:sp>/g),'pic',c(/<p:pic>/g),'grpSp',c(/<p:grpSp>/g),'a:t',c(/<a:t>/g),'==')
}
console.log('\n--- slide1 spTree ---')
const x1 = await zip.file(slides[0]).async('text')
console.log((x1.match(/<p:spTree>([\s\S]*?)<\/p:spTree>/)?.[1] || x1).slice(0, 2000))
fs.rmSync('scripts/conv2.mjs')
