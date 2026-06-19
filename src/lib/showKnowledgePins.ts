const STORAGE_KEY = 'deck-editor.showKnowledgePins'

/** User preference: show knowledge-graph mapping pins on the slide canvas. */
export function readShowKnowledgePins(): boolean {
  if (typeof window === 'undefined') return false
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === null) return false
  return raw === '1'
}

export function writeShowKnowledgePins(show: boolean): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, show ? '1' : '0')
}
