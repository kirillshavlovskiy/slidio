// Text element content is a plain multi-line string, so list "formatting" is
// applied by prefixing each non-empty line with a bullet/number marker (and
// toggling it back off). Indentation is preserved so nested levels survive a
// round-trip. Shared by the floating toolbar and the inline text editor.

export type ListMode = 'bullet' | 'number' | 'none'

const LIST_MARKER_RE = /^(\s*)(?:[•◦▪‣·*–—-]|\(?\d+[.)]|\(?[A-Za-z][.)])\s+(.*)$/

function splitMarker(line: string): { indent: string; text: string } {
  const m = line.match(LIST_MARKER_RE)
  if (m) return { indent: m[1], text: m[2] }
  const im = line.match(/^(\s*)(.*)$/)
  return { indent: im?.[1] ?? '', text: im?.[2] ?? line }
}

/** Detect whether every non-empty line is already a bullet/numbered item. */
export function listState(content: string): ListMode {
  const lines = content.split('\n').filter(l => l.trim())
  if (lines.length === 0) return 'none'
  if (lines.every(l => /^\s*[•◦▪‣·*–—-]\s+/.test(l))) return 'bullet'
  if (lines.every(l => /^\s*\(?\d+[.)]\s+/.test(l))) return 'number'
  return 'none'
}

/** Re-mark every non-empty line as a bullet, number, or plain line. */
export function applyListMode(content: string, mode: ListMode): string {
  let n = 0
  return content
    .split('\n')
    .map(line => {
      if (!line.trim()) return line
      const { indent, text } = splitMarker(line)
      if (mode === 'bullet') return `${indent}• ${text}`
      if (mode === 'number') {
        n += 1
        return `${indent}${n}. ${text}`
      }
      return `${indent}${text}`
    })
    .join('\n')
}

/** Toggle a list mode on/off, returning the new content string. */
export function toggleListMode(content: string, mode: 'bullet' | 'number'): string {
  return applyListMode(content, listState(content) === mode ? 'none' : mode)
}
