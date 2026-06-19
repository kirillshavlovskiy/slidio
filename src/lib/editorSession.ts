import type { DisplayMessage } from '@/components/ChatPanel'
import type { IncompleteAgentContext } from '@/lib/agent/routingHeuristics'
import type { Change, SlideData } from '@/lib/types'

import type { AgentPauseState } from '@/lib/agent/agentPauseState'

export const EDITOR_SESSION_VERSION = 1

export type EditorSession = {
  version: typeof EDITOR_SESSION_VERSION
  updatedAt: number
  slides: SlideData[]
  activeSlideId: string | null
  selectedSlideIds: string[]
  selectedElementIds: string[]
  pendingChanges: Change[] | null
  amendmentCheckpoint: SlideData[] | null
  pendingSummary: string
  amendmentSource: 'single' | 'agent' | null
  pendingDecisionId: string | null
  agentRunIncomplete: boolean
  incompleteAgentContext: IncompleteAgentContext | null
  /** Full agent thread for pipeline pause/resume (edit/step limits). */
  agentPauseState: AgentPauseState | null
  pendingAgentInstruction: string | null
  display: DisplayMessage[]
}

/** Strip heavy fields before persisting (render screenshots, etc.). */
export function slimDisplayForSession(display: DisplayMessage[]): DisplayMessage[] {
  return display.map(msg => {
    if (!msg.agentStep) return msg
    const { image: _image, ...step } = msg.agentStep
    return { ...msg, agentStep: step }
  })
}

export function hasRestorableEditorSession(session: EditorSession | null | undefined): boolean {
  if (!session || session.version !== EDITOR_SESSION_VERSION) return false
  return (
    (session.pendingChanges?.length ?? 0) > 0 ||
    session.agentRunIncomplete ||
    !!session.agentPauseState ||
    !!session.pendingAgentInstruction ||
    session.display.some(m => !!m.agentStep || m.patchStatus === 'pending')
  )
}

const localKey = (presentationId: string) => `deck-editor-session:${presentationId}`

export function writeEditorSessionLocal(presentationId: string, session: EditorSession | null): void {
  if (typeof window === 'undefined') return
  try {
    if (!session || !hasRestorableEditorSession(session)) {
      localStorage.removeItem(localKey(presentationId))
      return
    }
    localStorage.setItem(localKey(presentationId), JSON.stringify(session))
  } catch (e) {
    console.warn('[editorSession] local write failed', e)
  }
}

export function readEditorSessionLocal(presentationId: string): EditorSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(localKey(presentationId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as EditorSession
    if (parsed?.version !== EDITOR_SESSION_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

export function clearEditorSessionLocal(presentationId: string): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(localKey(presentationId))
}
