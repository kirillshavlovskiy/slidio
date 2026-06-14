import { SlideData } from './types'

/** Token-spend / model tier the action should run at (see /api router & modelFor). */
export type QuickActionEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Context the registry uses to decide availability and build the instruction. */
export interface QuickActionContext {
  slides: SlideData[]
  activeSlideId: string
  /** 0-based index of the active slide in the deck (-1 if none). */
  activeSlideIndex: number
  selectedSlideIds: string[]
  /** Ids of elements selected on the active slide (drives element-scoped actions). */
  selectedElementIds: string[]
}

/**
 * A "quick action" is a one-click smart operation that runs through the AI agent
 * with a predefined instruction + effort. The agent reads the slide(s), applies
 * the change with its tools, and verifies the rendered result.
 *
 * Add new actions by appending to QUICK_ACTIONS — the menu, availability gating
 * and dispatch are all driven from this registry, so no other code changes are
 * needed to introduce a new smart action.
 */
export interface QuickAction {
  id: string
  label: string
  /** Lucide icon name (resolved via lib/icons getIcon in the UI). */
  icon: string
  /** Short one-liner shown in the menu. */
  description: string
  /** Effort/model tier; defaults to 'medium' when omitted. */
  effort?: QuickActionEffort
  /** Whether the action makes sense for the current selection/context. */
  isAvailable: (ctx: QuickActionContext) => boolean
  /** Why the action is unavailable (shown as a hint when disabled). */
  unavailableHint?: string
  /** Build the natural-language instruction handed to the agent. */
  buildInstruction: (ctx: QuickActionContext) => string
}

/** 1-based position label for a slide id, used to ground instructions for the agent. */
function pos(ctx: QuickActionContext, id: string): number {
  return ctx.slides.findIndex(s => s.id === id) + 1
}

/** Elements currently selected on the active slide. */
function selectedElements(ctx: QuickActionContext) {
  const slide = ctx.slides.find(s => s.id === ctx.activeSlideId)
  if (!slide) return []
  return slide.elements.filter(e => ctx.selectedElementIds.includes(e.id))
}

/** A compact "id (type): preview" tag the agent can use to target an element precisely. */
function elementTag(el: { id: string; type: string; content?: string }): string {
  const preview = el.content?.replace(/\s+/g, ' ').trim().slice(0, 40)
  return preview ? `${el.id} (${el.type}: "${preview}")` : `${el.id} (${el.type})`
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'split-slide',
    label: 'Split slide',
    icon: 'SplitSquareHorizontal',
    description: 'Divide the current slide into two balanced slides.',
    effort: 'high',
    isAvailable: ctx => ctx.activeSlideIndex >= 0,
    buildInstruction: ctx => {
      const n = ctx.activeSlideIndex + 1
      return (
        `Split slide ${n} (id: ${ctx.activeSlideId}) into TWO balanced slides. ` +
        `Read it first, then divide its content into two logical halves, keeping related points together. ` +
        `Preserve the SAME visual style, fonts, colors and layout on both slides. ` +
        `Keep the first half on slide ${n}, and add the second half as a NEW slide that must appear ` +
        `IMMEDIATELY AFTER slide ${n}: in the add-slide change set index = ${n} (the 0-based deck ` +
        `position right after slide ${n}) — do NOT omit index, or it will be appended at the end of the deck. ` +
        `Give the new slide a continuation title if appropriate. ` +
        `Make sure neither slide is overcrowded or overflows the bounds, then render both to verify they look clean.`
      )
    },
  },
  {
    id: 'merge-slides',
    label: 'Merge slides',
    icon: 'Combine',
    description: 'Combine the selected slides into one.',
    effort: 'high',
    isAvailable: ctx => ctx.selectedSlideIds.length >= 2,
    unavailableHint: 'Select 2 or more slides to merge.',
    buildInstruction: ctx => {
      const ids = ctx.selectedSlideIds
      const labels = ids.map(id => `slide ${pos(ctx, id)} (id: ${id})`).join(', ')
      const firstPos = pos(ctx, ids[0])
      return (
        `Merge these ${ids.length} slides into ONE: ${labels}. ` +
        `Read them all, then combine their content cohesively onto the FIRST one (slide ${firstPos}), ` +
        `condensing and rewording where needed so everything fits a single slide WITHOUT overflowing, ` +
        `while keeping a consistent style. Then DELETE the other merged slides. ` +
        `Render the merged slide to verify it is clean and readable.`
      )
    },
  },
  {
    id: 'tidy-layout',
    label: 'Tidy layout',
    icon: 'LayoutGrid',
    description: 'Fix overlaps, alignment and spacing on the selected slide(s).',
    effort: 'medium',
    isAvailable: ctx => ctx.activeSlideIndex >= 0,
    buildInstruction: ctx => {
      // Slide-scoped action: target every selected slide, falling back to the active one.
      const targetIds =
        ctx.selectedSlideIds.length > 0 ? ctx.selectedSlideIds : [ctx.activeSlideId]
      const labels = targetIds.map(id => `slide ${pos(ctx, id)} (id: ${id})`).join(', ')
      const sel = selectedElements(ctx)
      // If specific elements are selected on a single slide, tidy just those.
      if (targetIds.length === 1 && sel.length > 1) {
        const tags = sel.map(elementTag).join('; ')
        return (
          `On slide ${pos(ctx, targetIds[0])} (id: ${targetIds[0]}), tidy up ONLY these selected elements: ${tags}. ` +
          `Fix overlaps among them, align their edges, even out spacing, and keep them within the slide bounds. ` +
          `Do NOT move or restyle other elements. Render to verify they look clean and aligned.`
        )
      }
      return (
        `Tidy up the layout of ${labels}. ` +
        `Fix overlapping elements, misalignment, inconsistent spacing/margins, and anything overflowing the slide bounds. ` +
        `Keep ALL content and styling — only adjust position, size and alignment for a clean, balanced result. ` +
        `Render each affected slide to verify nothing overlaps and the grid feels even.`
      )
    },
  },
  {
    id: 'add-icons',
    label: 'Add icons to points',
    icon: 'Sparkles',
    description: 'Place a fitting icon next to each key point (or selected items).',
    effort: 'medium',
    isAvailable: ctx => ctx.activeSlideIndex >= 0,
    buildInstruction: ctx => {
      const n = ctx.activeSlideIndex + 1
      const sel = selectedElements(ctx)
      // Element-scoped: if elements are selected, only add icons next to THOSE.
      if (sel.length > 0) {
        const tags = sel.map(elementTag).join('; ')
        return (
          `Add a relevant icon element next to ONLY these selected elements on slide ${n} (id: ${ctx.activeSlideId}): ${tags}. ` +
          `For EACH selected element pick an icon (from the allowed icon list) whose meaning matches that item, ` +
          `size it ≈0.4–0.6in, color it to match the slide's accent or text color, and align it neatly to the ` +
          `LEFT of that element without overlapping its text (nudge the text right if needed). ` +
          `Do NOT touch other elements. Render to verify alignment.`
        )
      }
      return (
        `Add a relevant icon element next to each key point / bullet / KPI on slide ${n} (id: ${ctx.activeSlideId}). ` +
        `Pick icons (from the allowed icon list) whose meaning matches each item, size them ≈0.4–0.6in, ` +
        `color them to match the slide's accent or text color, and align them neatly to the LEFT of each item ` +
        `without overlapping the text (nudge text right if needed). Render to verify alignment.`
      )
    },
  },
  {
    id: 'visualize-chart',
    label: 'Visualize as chart',
    icon: 'BarChart3',
    description: 'Turn metrics on this slide (or selected items) into a chart.',
    effort: 'high',
    isAvailable: ctx => ctx.activeSlideIndex >= 0,
    buildInstruction: ctx => {
      const n = ctx.activeSlideIndex + 1
      const sel = selectedElements(ctx)
      // Element-scoped: build the chart from the data in the selected elements.
      if (sel.length > 0) {
        const tags = sel.map(elementTag).join('; ')
        return (
          `Using the metrics/numbers contained in ONLY these selected elements on slide ${n} (id: ${ctx.activeSlideId}): ${tags}, ` +
          `build a single clear chart element (choose the best chart type). Place it where those elements are without ` +
          `overlapping the title, and remove or trim the now-redundant selected text elements you charted. ` +
          `Leave all OTHER elements untouched. If the selected elements contain no quantitative data, make NO changes ` +
          `and finish by saying there was nothing to visualize.`
        )
      }
      return (
        `Look at slide ${n} (id: ${ctx.activeSlideId}). If it contains metrics, numbers or comparisons, ` +
        `turn them into a clear chart element (choose the best chart type) placed so it does NOT overlap the title, ` +
        `and trim now-redundant text. If there is no quantitative data to chart, make NO changes and finish by ` +
        `saying there was nothing to visualize.`
      )
    },
  },
  {
    id: 'visualize-table',
    label: 'Visualize as table',
    icon: 'Table',
    description: 'Lay out data on this slide (or selected items) as a clean table.',
    effort: 'high',
    isAvailable: ctx => ctx.activeSlideIndex >= 0,
    buildInstruction: ctx => {
      const n = ctx.activeSlideIndex + 1
      const sel = selectedElements(ctx)
      // There is no native table element — build the table from rect + text primitives.
      const howto =
        `Build the table from PRIMITIVES (there is no table element type): use rect elements for a ` +
        `header band and subtle row separators / zebra striping (place these BEHIND the text using a low z-index), ` +
        `and a text element for EACH cell. Snap cells into a real grid: every column shares the same x and width, ` +
        `every row shares the same height and top, header text is bold, and cell text is consistently aligned ` +
        `(left for labels, right for numbers). Keep it inside the slide bounds and clear of the title.`
      // Element-scoped: tabulate only the selected elements' data.
      if (sel.length > 0) {
        const tags = sel.map(elementTag).join('; ')
        return (
          `Using the data in ONLY these selected elements on slide ${n} (id: ${ctx.activeSlideId}): ${tags}, ` +
          `arrange it as a clean table. ${howto} Remove or trim the now-redundant selected text you tabulated, ` +
          `and leave all OTHER elements untouched. If the selected elements contain no tabular/structured data, ` +
          `make NO changes and finish by saying there was nothing to tabulate. Render to verify the grid is aligned.`
        )
      }
      return (
        `Look at slide ${n} (id: ${ctx.activeSlideId}). If it contains structured data, comparisons, lists of ` +
        `metrics or key/value pairs, arrange them as a clean table. ${howto} Trim now-redundant text. ` +
        `If there is no tabular/structured data, make NO changes and finish by saying there was nothing to tabulate. ` +
        `Render to verify the grid is aligned.`
      )
    },
  },
]
