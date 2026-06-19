import { ConversationMessage, DecisionRecord, SlideData, SlideVersion } from './types'
import type { EditorSession } from './editorSession'

export async function savePresentation(
  id: string,
  data: {
    slides?: SlideData[]
    conversationHistory?: ConversationMessage[]
    activeSlideId?: string
    name?: string
    editorSession?: EditorSession | null
  }
): Promise<void> {
  const body: Record<string, unknown> = { id, ...data }
  if (data.editorSession !== undefined) {
    body.editorSession =
      data.editorSession && Object.keys(data.editorSession).length > 0
        ? data.editorSession
        : null
  }
  await fetch('/api/presentations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function saveVersion(
  presentationId: string,
  version: SlideVersion
): Promise<string | null> {
  const res = await fetch('/api/versions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: version.id,
      presentationId,
      label: version.label,
      changeLog: version.changeLog,
      slides: version.slides,
      decisionId: version.decisionId,
      slideCount: version.slideCount,
      changedSlideIds: version.changedSlideIds,
      branchId: version.branchId ?? null,
      branchLabel: version.branchLabel ?? null,
      parentVersionId: version.parentVersionId ?? null,
      isBranchRoot: version.isBranchRoot ?? false,
    }),
  })
  if (!res.ok) {
    console.warn(`[persist] saveVersion failed (HTTP ${res.status})`)
    return null
  }
  const saved = await res.json()
  return saved.id ?? null
}

/**
 * Create or update a DecisionRecord. The decision's own id is sent so the row
 * shares the client id — a later status change (pending → accepted/rejected)
 * upserts the same row instead of relying on a fragile id-swap.
 */
export async function persistDecision(
  presentationId: string,
  decision: DecisionRecord
): Promise<void> {
  const res = await fetch('/api/decisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: decision.id,
      presentationId,
      instruction: decision.instruction,
      proposedSummary: decision.proposedSummary,
      proposedChanges: decision.proposedChanges,
      status: decision.status,
      slideIds: decision.slideIds,
      selectedElementIds: decision.selectedElementIds,
      snapshotBefore: decision.snapshotBefore,
    }),
  })
  if (!res.ok) console.warn(`[persist] persistDecision failed (HTTP ${res.status})`)
}

export async function setDecisionStatus(
  id: string,
  status: DecisionRecord['status'],
  rejectionReason?: string
): Promise<void> {
  const res = await fetch('/api/decisions', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      status,
      ...(rejectionReason !== undefined ? { rejectionReason } : {}),
    }),
  })
  if (!res.ok) console.warn(`[persist] setDecisionStatus failed (HTTP ${res.status})`)
}
