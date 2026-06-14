'use client'

import { SlideElement, ElementStyle, ChartSpec, ChartType, SeriesType } from '@/lib/types'
import { DEFAULT_FONT } from '@/lib/fonts'
import { elementFillHex, elementTextHex, isFillElement } from '@/lib/elementStyle'
import { getIcon } from '@/lib/icons'
import { useDesignTokens } from '@/components/DesignTokensProvider'
import FontFamilySelect from '@/components/FontFamilySelect'
import type { DSColorToken } from '@/lib/designSystem'

type Patch = {
  content?: string
  style?: Partial<ElementStyle>
  chart?: ChartSpec
  icon?: string
  x?: number
  y?: number
  w?: number
  h?: number
}

interface Props {
  element: SlideElement | null
  selectedCount: number
  onUpdate: (elementId: string, patch: Patch) => void
  /** Open the icon picker for the given element id (icon elements only). */
  onPickIcon?: (elementId: string) => void
}

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900]

function hashHex(v?: string): string {
  if (!v) return '#000000'
  const h = v.replace('#', '')
  return `#${h.padStart(6, '0').slice(0, 6)}`
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-3 border-b border-[#16263b]">
      <p className="text-[10px] font-bold tracking-widest text-[#64748b] uppercase mb-2">{title}</p>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

/** A labelled field that fills a cell; pair two per Row. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex-1 min-w-0 flex items-center justify-between gap-1.5 rounded-md border border-[#1e3a5f] bg-[#0b1626] px-2 py-1.5">
      <span className="text-[10px] text-[#64748b] flex-shrink-0">{label}</span>
      <div className="flex items-center gap-1 min-w-0">{children}</div>
    </label>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2">{children}</div>
}

function NumberInput({
  value,
  onCommit,
  step = 1,
  suffix,
  width = 'w-12',
  listId,
}: {
  value: number | undefined
  onCommit: (n: number | undefined) => void
  step?: number
  suffix?: string
  width?: string
  listId?: string
}) {
  return (
    <span className="flex items-center gap-0.5">
      <input
        type="number"
        step={step}
        list={listId}
        value={value ?? ''}
        onChange={e => {
          const raw = e.target.value
          onCommit(raw === '' ? undefined : Number(raw))
        }}
        className={`${width} bg-transparent text-right text-[11px] text-[#e2e8f0] outline-none tabular-nums`}
      />
      {suffix && <span className="text-[9px] text-[#475569]">{suffix}</span>}
    </span>
  )
}

function SelectInput<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as T)}
      className="bg-transparent text-right text-[11px] text-[#e2e8f0] outline-none cursor-pointer max-w-[96px]"
    >
      {options.map(o => (
        <option key={o.value} value={o.value} className="bg-[#0d1b2a]">
          {o.label}
        </option>
      ))}
    </select>
  )
}

function ColorInput({
  hex,
  onChange,
}: {
  hex: string | undefined
  onChange: (hex: string) => void
}) {
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="color"
        value={hashHex(hex)}
        onChange={e => onChange(e.target.value.replace('#', '').toUpperCase())}
        className="w-4 h-4 rounded border border-[#1e3a5f] bg-transparent cursor-pointer p-0"
      />
      <input
        value={hex ?? ''}
        onChange={e => onChange(e.target.value.replace('#', '').toUpperCase())}
        placeholder="—"
        className="w-[58px] bg-transparent text-right text-[11px] text-[#e2e8f0] outline-none font-mono uppercase"
      />
    </span>
  )
}

/** Quick-pick swatches sourced from the active design system. */
function SwatchStrip({
  tokens,
  palette,
  onPick,
}: {
  tokens: DSColorToken[]
  palette: string[]
  onPick: (hex: string) => void
}) {
  const named = tokens.slice(0, 14)
  const extra = palette.filter(h => !named.some(t => t.hex.toUpperCase() === h.toUpperCase())).slice(0, 16)
  if (named.length === 0 && extra.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1 px-0.5">
      {named.map(t => (
        <button
          key={`n-${t.name}`}
          type="button"
          title={`${t.name} · #${t.hex}`}
          onClick={() => onPick(t.hex.toUpperCase())}
          className="w-4 h-4 rounded-sm border border-black/40 hover:ring-1 hover:ring-[#60a5fa]"
          style={{ backgroundColor: `#${t.hex}` }}
        />
      ))}
      {extra.map(h => (
        <button
          key={`p-${h}`}
          type="button"
          title={`#${h}`}
          onClick={() => onPick(h.toUpperCase())}
          className="w-4 h-4 rounded-sm border border-black/40 hover:ring-1 hover:ring-[#60a5fa]"
          style={{ backgroundColor: `#${h}` }}
        />
      ))}
    </div>
  )
}

const CHART_PALETTE = [
  '60A5FA', '34D399', 'FBBF24', 'F87171', 'A78BFA', '22D3EE', 'FB7185', 'A3E635',
]

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'bar', label: 'Bar' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'combo', label: 'Combo (bar + line)' },
  { value: 'pie', label: 'Pie' },
  { value: 'donut', label: 'Donut' },
]

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-[10px] text-[#94a3b8] cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="accent-[#60a5fa]"
      />
      {label}
    </label>
  )
}

function ChartEditor({ spec, onChange }: { spec: ChartSpec; onChange: (next: ChartSpec) => void }) {
  const isPie = spec.type === 'pie' || spec.type === 'donut'
  const cats = spec.categories || []
  const series = spec.series || []
  const cell = 'w-full bg-[#0b1626] border border-[#1e3a5f] rounded px-1 py-0.5 text-[11px] text-[#e2e8f0] outline-none focus:border-[#60a5fa]'

  const update = (patch: Partial<ChartSpec>) => onChange({ ...spec, ...patch })

  const setCategory = (i: number, v: string) => {
    const next = [...cats]
    next[i] = v
    update({ categories: next })
  }
  const setValue = (si: number, ci: number, v: string) => {
    const nextSeries = series.map((s, idx) => {
      if (idx !== si) return s
      const vals = [...(s.values || [])]
      vals[ci] = Number(v) || 0
      return { ...s, values: vals }
    })
    update({ series: nextSeries })
  }
  const setSeriesName = (si: number, v: string) => {
    update({ series: series.map((s, idx) => (idx === si ? { ...s, name: v } : s)) })
  }
  const addCategory = () => {
    update({
      categories: [...cats, `Cat ${cats.length + 1}`],
      series: series.map(s => ({ ...s, values: [...(s.values || []), 0] })),
    })
  }
  const removeCategory = (i: number) => {
    update({
      categories: cats.filter((_, idx) => idx !== i),
      series: series.map(s => ({ ...s, values: (s.values || []).filter((_, idx) => idx !== i) })),
    })
  }
  const addSeries = () => {
    update({
      series: [...series, { name: `Series ${series.length + 1}`, values: cats.map(() => 0) }],
    })
  }
  const removeSeries = (si: number) => {
    update({ series: series.filter((_, idx) => idx !== si) })
  }
  const setSeriesColor = (si: number, hexv: string) => {
    update({ series: series.map((s, idx) => (idx === si ? { ...s, color: hexv } : s)) })
  }
  const setSeriesType = (si: number, t: SeriesType) => {
    update({ series: series.map((s, idx) => (idx === si ? { ...s, type: t } : s)) })
  }
  const setSeriesAxis = (si: number, axis: 'left' | 'right') => {
    update({ series: series.map((s, idx) => (idx === si ? { ...s, axis } : s)) })
  }
  const setSliceColor = (ci: number, hexv: string) => {
    const next = cats.map((_, i) => spec.palette?.[i] ?? CHART_PALETTE[i % CHART_PALETTE.length])
    next[ci] = hexv
    update({ palette: next })
  }
  const seriesColor = (i: number, override?: string) =>
    override || CHART_PALETTE[i % CHART_PALETTE.length]
  const sliceColor = (i: number) => spec.palette?.[i] ?? CHART_PALETTE[i % CHART_PALETTE.length]

  return (
    <Section title="Chart">
      <Row>
        <Field label="Type">
          <SelectInput
            value={spec.type}
            options={CHART_TYPES}
            onChange={v => update({ type: v as ChartType })}
          />
        </Field>
      </Row>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-[#64748b]">Title</span>
        <input
          value={spec.title ?? ''}
          onChange={e => update({ title: e.target.value })}
          placeholder="Chart title"
          className={cell}
        />
      </label>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 pt-0.5">
        <Toggle label="Legend" checked={spec.showLegend ?? series.length > 1} onChange={v => update({ showLegend: v })} />
        <Toggle label="Values" checked={!!spec.showValues} onChange={v => update({ showValues: v })} />
        {!isPie && <Toggle label="Grid" checked={spec.showGrid ?? true} onChange={v => update({ showGrid: v })} />}
        {!isPie && spec.type !== 'combo' && (
          <Toggle label="Stacked" checked={!!spec.stacked} onChange={v => update({ stacked: v })} />
        )}
      </div>

      {!isPie && (
        <div className="flex flex-col gap-1 pt-0.5">
          <Row>
            <Field label="X axis title">
              <input
                value={spec.xAxisTitle ?? ''}
                onChange={e => update({ xAxisTitle: e.target.value })}
                placeholder="e.g. Regime"
                className={cell}
              />
            </Field>
            <Field label={spec.type === 'combo' ? 'Left axis title' : 'Y axis title'}>
              <input
                value={spec.yAxisTitle ?? ''}
                onChange={e => update({ yAxisTitle: e.target.value })}
                placeholder="e.g. Avg P&L ($M)"
                className={cell}
              />
            </Field>
          </Row>
          {spec.type === 'combo' && (
            <Row>
              <Field label="Right axis title">
                <input
                  value={spec.y2AxisTitle ?? ''}
                  onChange={e => update({ y2AxisTitle: e.target.value })}
                  placeholder="e.g. Win Rate (%)"
                  className={cell}
                />
              </Field>
            </Row>
          )}
        </div>
      )}

      <div className="mt-1 overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 3 }}>
          <thead>
            <tr>
              <th className="text-[9px] text-[#475569] font-medium text-left pl-0.5">Category</th>
              {series.map((s, si) => (
                <th key={si} className="min-w-[64px]">
                  <div className="flex items-center gap-0.5">
                    <input
                      value={s.name}
                      onChange={e => setSeriesName(si, e.target.value)}
                      className={`${cell} font-medium`}
                    />
                    {series.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeSeries(si)}
                        title="Remove series"
                        className="text-[#64748b] hover:text-[#f87171] text-xs px-0.5"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cats.map((c, ci) => (
              <tr key={ci}>
                <td className="min-w-[72px]">
                  <div className="flex items-center gap-0.5">
                    <input value={c} onChange={e => setCategory(ci, e.target.value)} className={cell} />
                    {cats.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeCategory(ci)}
                        title="Remove row"
                        className="text-[#64748b] hover:text-[#f87171] text-xs px-0.5"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </td>
                {series.map((s, si) => (
                  <td key={si} className="min-w-[64px]">
                    <input
                      type="number"
                      value={s.values?.[ci] ?? 0}
                      onChange={e => setValue(si, ci, e.target.value)}
                      className={`${cell} text-right`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 pt-0.5">
        <button
          type="button"
          onClick={addCategory}
          className="flex-1 text-[10px] text-[#93c5fd] border border-[#1e3a5f] rounded px-2 py-1 hover:bg-[#13243a]"
        >
          + Row
        </button>
        {!isPie && (
          <button
            type="button"
            onClick={addSeries}
            className="flex-1 text-[10px] text-[#93c5fd] border border-[#1e3a5f] rounded px-2 py-1 hover:bg-[#13243a]"
          >
            + Series
          </button>
        )}
      </div>
      {spec.type === 'combo' && (
        <div className="pt-1 mt-1 border-t border-[#16263b]">
          <p className="text-[10px] text-[#64748b] mb-1.5">Series setup (type &amp; axis)</p>
          <div className="flex flex-col gap-1.5">
            {series.map((s, si) => (
              <div key={si} className="flex items-center gap-1.5">
                <span className="text-[10px] text-[#94a3b8] truncate min-w-0 flex-1">{s.name}</span>
                <select
                  value={s.type ?? 'bar'}
                  onChange={e => setSeriesType(si, e.target.value as SeriesType)}
                  className={`${cell} w-[68px] flex-none`}
                >
                  <option value="bar">Bar</option>
                  <option value="line">Line</option>
                  <option value="area">Area</option>
                </select>
                <select
                  value={s.axis ?? 'left'}
                  onChange={e => setSeriesAxis(si, e.target.value as 'left' | 'right')}
                  className={`${cell} w-[64px] flex-none`}
                  title="Which value axis this series is measured against"
                >
                  <option value="left">L axis</option>
                  <option value="right">R axis</option>
                </select>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-[#475569] leading-snug mt-1.5">
            Put a metric on a different scale (e.g. a % line beside value bars) on the R axis.
          </p>
        </div>
      )}

      <div className="pt-1 mt-1 border-t border-[#16263b]">
        <p className="text-[10px] text-[#64748b] mb-1.5">Colors</p>
        <div className="flex flex-col gap-1.5">
          {isPie
            ? cats.map((c, ci) => (
                <div key={ci} className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-[#94a3b8] truncate min-w-0">{c || `Slice ${ci + 1}`}</span>
                  <ColorInput hex={sliceColor(ci)} onChange={hexv => setSliceColor(ci, hexv)} />
                </div>
              ))
            : series.map((s, si) => (
                <div key={si} className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-[#94a3b8] truncate min-w-0">{s.name}</span>
                  <ColorInput hex={seriesColor(si, s.color)} onChange={hexv => setSeriesColor(si, hexv)} />
                </div>
              ))}
        </div>
      </div>

      {isPie && (
        <p className="text-[9px] text-[#475569] leading-snug">
          Pie / donut charts use the first series only — one slice per row.
        </p>
      )}
    </Section>
  )
}

export default function ElementInspector({ element, selectedCount, onUpdate, onPickIcon }: Props) {
  if (selectedCount === 0 || !element) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <p className="text-sm text-[#475569] font-medium">No element selected</p>
        <p className="text-[11px] text-[#334155] mt-1 leading-relaxed">
          Click an element on the slide to edit its typography, size and box styling here.
        </p>
      </div>
    )
  }

  if (selectedCount > 1) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <p className="text-sm text-[#475569] font-medium">{selectedCount} elements selected</p>
        <p className="text-[11px] text-[#334155] mt-1 leading-relaxed">
          Select a single element to edit its detailed styling.
        </p>
      </div>
    )
  }

  const el = element
  const s = el.style ?? {}
  const set = (patch: Patch) => onUpdate(el.id, patch)
  const setStyle = (style: Partial<ElementStyle>) => set({ style })
  const hasText = el.type === 'text' || el.type === 'chip'
  const isImage = el.type === 'image'
  const fillEl = isFillElement(el)
  const font = s.fontFace || DEFAULT_FONT

  const tokens = useDesignTokens()
  const dsColors = tokens?.colorTokens ?? []
  const dsPalette = tokens?.palette ?? []
  const dsSizes = tokens?.typeScalePt ?? []
  const sizeListId = dsSizes.length > 0 ? `ds-size-${el.id}` : undefined

  return (
    <div className="w-full">
      <div className="px-3 py-2.5 border-b border-[#16263b] flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#93c5fd] bg-[#1e3a5f] rounded px-1.5 py-0.5">
          {el.type}
        </span>
        <span className="text-[11px] text-[#64748b] truncate font-mono">{el.id}</span>
      </div>

      {sizeListId && (
        <datalist id={sizeListId}>
          {dsSizes.map(sz => (
            <option key={sz} value={sz} />
          ))}
        </datalist>
      )}

      {el.type === 'chart' && (
        <ChartEditor
          spec={
            el.chart ?? {
              type: 'bar',
              categories: ['A', 'B', 'C'],
              series: [{ name: 'Value', values: [1, 2, 3] }],
            }
          }
          onChange={chart => set({ chart })}
        />
      )}

      {el.type === 'icon' && (
        <Section title="Icon">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-[#1e3a5f] bg-[#0b1626]">
              {(() => {
                const Icon = getIcon(el.icon)
                return <Icon className="h-5 w-5" color={`#${elementTextHex(el)}`} />
              })()}
            </div>
            <button
              onClick={() => onPickIcon?.(el.id)}
              className="flex-1 rounded-md border border-[#1e3a5f] bg-[#0b1626] px-2 py-2 text-xs text-slate-200 hover:border-[#60a5fa] hover:bg-[#11243b]"
            >
              {el.icon || 'Choose icon'} — change…
            </button>
          </div>
          <Row>
            <Field label="Color">
              <input
                type="color"
                value={hashHex(s.color)}
                onChange={e => setStyle({ color: e.target.value.replace('#', '') })}
                className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
              />
            </Field>
            <Field label="Stroke">
              <NumberInput
                value={s.iconStrokeWidth ?? 2}
                step={0.25}
                onCommit={v => setStyle({ iconStrokeWidth: v })}
              />
            </Field>
          </Row>
        </Section>
      )}

      {hasText && (
        <Section title="Typography">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#64748b] w-10 flex-shrink-0">Font</span>
            <FontFamilySelect
              value={font}
              onChange={f => setStyle({ fontFace: f })}
              className="flex-1 min-w-0"
            />
          </div>
          <Row>
            <Field label="Size">
              <NumberInput
                value={s.fontSize}
                onCommit={n => setStyle({ fontSize: n })}
                suffix="pt"
                listId={sizeListId}
              />
            </Field>
            <Field label="Weight">
              <SelectInput
                value={String(s.fontWeight ?? (s.bold ? 700 : 400))}
                options={WEIGHTS.map(w => ({ value: String(w), label: String(w) }))}
                onChange={v => setStyle({ fontWeight: Number(v), bold: Number(v) >= 600 })}
              />
            </Field>
          </Row>
          <Row>
            <Field label="Color">
              <ColorInput hex={elementTextHex(el)} onChange={c => setStyle({ color: c })} />
            </Field>
            <Field label="Align">
              <SelectInput
                value={s.align ?? 'left'}
                options={[
                  { value: 'left', label: 'start' },
                  { value: 'center', label: 'center' },
                  { value: 'right', label: 'end' },
                ]}
                onChange={v => setStyle({ align: v })}
              />
            </Field>
          </Row>
          <SwatchStrip tokens={dsColors} palette={dsPalette} onPick={c => setStyle({ color: c })} />
          <Row>
            <Field label="Line Height">
              <NumberInput
                value={s.lineHeight}
                onCommit={n => setStyle({ lineHeight: n })}
                step={0.05}
                width="w-10"
              />
            </Field>
            <Field label="Tracking">
              <NumberInput
                value={s.charSpacing}
                onCommit={n => setStyle({ charSpacing: n })}
                step={0.1}
                suffix="pt"
                width="w-10"
              />
            </Field>
          </Row>
        </Section>
      )}

      {isImage && (
        <Section title="Image">
          <label className="flex items-center justify-between gap-2 rounded-md border border-[#1e3a5f] bg-[#0b1626] px-2 py-1.5 cursor-pointer">
            <span className="text-[11px] text-[#cbd5e1]">Invert colors</span>
            <input
              type="checkbox"
              checked={!!s.invert}
              onChange={e => setStyle({ invert: e.target.checked })}
              className="accent-[#60a5fa] w-3.5 h-3.5"
            />
          </label>
          <Field label="Fit">
            <SelectInput
              value={s.objectFit ?? 'contain'}
              options={[
                { value: 'contain', label: 'contain' },
                { value: 'cover', label: 'cover' },
                { value: 'fill', label: 'fill' },
              ]}
              onChange={v => setStyle({ objectFit: v })}
            />
          </Field>
        </Section>
      )}

      <Section title="Size & Position">
        <Row>
          <Field label="Width">
            <NumberInput value={round(el.w)} onCommit={n => set({ w: n ?? el.w })} step={0.01} suffix="in" />
          </Field>
          <Field label="Height">
            <NumberInput value={round(el.h)} onCommit={n => set({ h: n ?? el.h })} step={0.01} suffix="in" />
          </Field>
        </Row>
        <Row>
          <Field label="X">
            <NumberInput value={round(el.x)} onCommit={n => set({ x: n ?? el.x })} step={0.01} suffix="in" />
          </Field>
          <Field label="Y">
            <NumberInput value={round(el.y)} onCommit={n => set({ y: n ?? el.y })} step={0.01} suffix="in" />
          </Field>
        </Row>
      </Section>

      <Section title="Alignment">
        <Row>
          <Field label="Horizontal">
            <SelectInput
              value={s.align ?? 'left'}
              options={[
                { value: 'left', label: 'left' },
                { value: 'center', label: 'center' },
                { value: 'right', label: 'right' },
              ]}
              onChange={v => setStyle({ align: v })}
            />
          </Field>
          <Field label="Vertical">
            <SelectInput
              value={s.valign ?? 'middle'}
              options={[
                { value: 'top', label: 'top' },
                { value: 'middle', label: 'middle' },
                { value: 'bottom', label: 'bottom' },
              ]}
              onChange={v => setStyle({ valign: v })}
            />
          </Field>
        </Row>
      </Section>

      <Section title="Box">
        <Field label="Opacity">
          <NumberInput
            value={s.opacity ?? 100}
            onCommit={n => setStyle({ opacity: n })}
            suffix="%"
          />
        </Field>
        {!isImage && (
          <>
            <Field label="Fill">
              <ColorInput
                hex={fillEl ? elementFillHex(el) : s.bg}
                onChange={c => setStyle({ bg: c })}
              />
            </Field>
            <SwatchStrip tokens={dsColors} palette={dsPalette} onPick={c => setStyle({ bg: c })} />
          </>
        )}
        <p className="text-[9px] text-[#475569] mt-0.5">Padding (in)</p>
        <Row>
          <Field label="Top">
            <NumberInput value={s.padTop} onCommit={n => setStyle({ padTop: n })} step={0.02} width="w-10" />
          </Field>
          <Field label="Right">
            <NumberInput value={s.padRight} onCommit={n => setStyle({ padRight: n })} step={0.02} width="w-10" />
          </Field>
        </Row>
        <Row>
          <Field label="Bottom">
            <NumberInput value={s.padBottom} onCommit={n => setStyle({ padBottom: n })} step={0.02} width="w-10" />
          </Field>
          <Field label="Left">
            <NumberInput value={s.padLeft} onCommit={n => setStyle({ padLeft: n })} step={0.02} width="w-10" />
          </Field>
        </Row>
        <Row>
          <Field label="Border">
            <NumberInput
              value={s.borderWidth}
              onCommit={n => setStyle({ borderWidth: n })}
              suffix="px"
              width="w-9"
            />
          </Field>
          <Field label="Style">
            <SelectInput
              value={s.borderStyle ?? 'solid'}
              options={[
                { value: 'solid', label: 'solid' },
                { value: 'dashed', label: 'dashed' },
                { value: 'dotted', label: 'dotted' },
              ]}
              onChange={v => setStyle({ borderStyle: v })}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Border Color">
            <ColorInput hex={s.borderColor} onChange={c => setStyle({ borderColor: c })} />
          </Field>
        </Row>
        <Field label="Border Radius">
          <NumberInput
            value={s.borderRadius}
            onCommit={n => setStyle({ borderRadius: n })}
            suffix="px"
          />
        </Field>
      </Section>
    </div>
  )
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
