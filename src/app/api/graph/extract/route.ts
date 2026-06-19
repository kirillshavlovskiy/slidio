import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { canAccessGraph } from '@/lib/hubAccess'
import { fileTypeFromName } from '@/lib/parseDocumentServer'
import { extractTextWithSkill, needsSkillExtract } from '@/lib/graph/skillExtract'
import { extractPptxText } from '@/lib/ooxmlTextExtract'

export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_CHARS = 200_000
/** Stay under typical serverless body limits (~4.5 MB). */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const branchId = (formData.get('branchId') as string | null)?.trim()

    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    if (!branchId) return NextResponse.json({ error: 'branchId required' }, { status: 400 })

    const access = await canAccessGraph(session.user.id, branchId, 'viewer')
    if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const fileType = fileTypeFromName(file.name)
    if (!needsSkillExtract(file.name) && fileType === 'unknown') {
      return NextResponse.json(
        { error: 'Unsupported file type. Use PDF, DOCX, PPTX, or XLSX.' },
        { status: 400 }
      )
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `File is too large for server extraction (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
        },
        { status: 413 }
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    let text = ''
    let method: 'skill' | 'local' = 'skill'

    if (fileType === 'pptx') {
      try {
        text = await extractPptxText(buffer)
        if (text.trim()) method = 'local'
      } catch {
        /* fall through to skill */
      }
    }

    if (!text.trim()) {
      text = await extractTextWithSkill(buffer, file.name)
      method = 'skill'
    }

    text = text.trim()
    if (!text) {
      return NextResponse.json({ error: 'No readable text could be extracted from this file.' }, { status: 400 })
    }

    const truncated = text.length > MAX_CHARS
    if (truncated) text = text.slice(0, MAX_CHARS) + '\n\n…[truncated]'

    return NextResponse.json({
      name: file.name.replace(/\.[^.]+$/, ''),
      text,
      chars: text.length,
      truncated,
      fileType,
      method,
    })
  } catch (err) {
    console.error('graph extract POST error:', err)
    const message = err instanceof Error ? err.message : 'Extraction failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
