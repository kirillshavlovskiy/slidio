export interface SlideSelectModifiers {
  shift: boolean
  ctrl: boolean
}

export interface SlideSelectionResult {
  selected: string[]
  anchor: string
  active: string
}

export function computeSlideSelection(
  slideId: string,
  allSlideIds: string[],
  currentSelected: string[],
  anchorId: string,
  modifiers: SlideSelectModifiers
): SlideSelectionResult {
  const index = allSlideIds.indexOf(slideId)
  const anchorIndex = allSlideIds.indexOf(anchorId)

  if (modifiers.shift && anchorIndex !== -1 && index !== -1) {
    const start = Math.min(anchorIndex, index)
    const end = Math.max(anchorIndex, index)
    return {
      selected: allSlideIds.slice(start, end + 1),
      anchor: anchorId,
      active: slideId,
    }
  }

  if (modifiers.ctrl) {
    const isSelected = currentSelected.includes(slideId)
    const selected = isSelected
      ? currentSelected.filter(id => id !== slideId)
      : [...currentSelected, slideId]

    return {
      selected: selected.length === 0 ? [slideId] : selected,
      anchor: slideId,
      active: slideId,
    }
  }

  return {
    selected: [slideId],
    anchor: slideId,
    active: slideId,
  }
}
