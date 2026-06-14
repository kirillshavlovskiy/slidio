'use client'
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  Area,
  AreaChart,
  ComposedChart,
  Pie,
  PieChart,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  LabelList,
} from 'recharts'
import type { ChartSpec, SeriesType } from '@/lib/types'

const DEFAULT_PALETTE = [
  '60A5FA', '34D399', 'FBBF24', 'F87171', 'A78BFA', '22D3EE', 'FB7185', 'A3E635',
]

interface Props {
  spec: ChartSpec
  /** Render box in px (already scaled to the canvas base — the parent applies zoom). */
  width: number
  height: number
  /** Axis/legend/label text color (hex, no #). Defaults to a light slate. */
  textColor?: string
  /** Grid line color (hex, no #). */
  gridColor?: string
}

function hex(c?: string, fallback = '94A3B8') {
  if (!c) return `#${fallback}`
  return c.startsWith('#') ? c : `#${c}`
}

export default function ChartElement({ spec, width, height, textColor, gridColor }: Props) {
  const palette = spec.palette?.length ? spec.palette : DEFAULT_PALETTE
  const seriesColor = (i: number, override?: string) =>
    override ? hex(override) : hex(palette[i % palette.length])
  const tick = hex(textColor, 'CBD5E1')
  const grid = hex(gridColor, '334155')

  // ── Harden against malformed specs (AI can omit fields / send bad values) ──
  // A missing categories/series array, or non-numeric values, must never crash the
  // whole canvas — fall back to safe defaults and a placeholder when there's no data.
  const categories = Array.isArray(spec.categories)
    ? spec.categories.map(c => (c == null ? '' : String(c)))
    : []
  const series = (Array.isArray(spec.series) ? spec.series : [])
    .filter(s => s && typeof s === 'object')
    .map((s, i) => ({
      name: s.name != null && String(s.name).trim() ? String(s.name) : `Series ${i + 1}`,
      values: Array.isArray(s.values) ? s.values.map(v => (Number.isFinite(Number(v)) ? Number(v) : 0)) : [],
      color: s.color,
      type: (s.type === 'line' || s.type === 'area' || s.type === 'bar' ? s.type : undefined) as
        | SeriesType
        | undefined,
      axis: s.axis === 'right' ? ('right' as const) : ('left' as const),
    }))

  const showLegend = spec.showLegend ?? series.length > 1
  const showGrid = spec.showGrid ?? true

  const titleH = spec.title ? 22 : 0
  const fontSize = 11

  // Axis titles (units live here, e.g. "Avg P&L ($M)" / "Win Rate (%)"). We render
  // them as HTML overlays around the plot — recharts' own axis `label`/`<Label>` is
  // unreliable in v3 and silently drops the rotated titles. Reserve a strip on each
  // side for the title text so it never overlaps the tick numbers or the plot.
  const yTitle = spec.yAxisTitle?.trim()
  const y2Title = spec.y2AxisTitle?.trim()
  const xTitle = spec.xAxisTitle?.trim()
  const AXIS_TITLE_STRIP = 16
  const padL = yTitle ? AXIS_TITLE_STRIP : 0
  const padR = y2Title ? AXIS_TITLE_STRIP : 0
  const padB = xTitle ? AXIS_TITLE_STRIP : 0

  const chartW = Math.max(40, width - padL - padR)
  const chartH = Math.max(40, height - titleH - padB)

  const hasData = categories.length > 0 && series.length > 0
  if (!hasData) {
    return (
      <div
        style={{
          width,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px dashed #475569',
          borderRadius: 4,
          color: '#64748b',
          fontSize: 11,
          textAlign: 'center',
          padding: 8,
          pointerEvents: 'none',
        }}
      >
        {spec.title ? `${spec.title} — add categories & series` : 'Chart — add categories & series'}
      </div>
    )
  }

  // Recharts wants row objects keyed by series name: one row per category.
  const rows = categories.map((cat, i) => {
    const row: Record<string, string | number> = { name: cat }
    series.forEach(s => {
      row[s.name] = s.values[i] ?? 0
    })
    return row
  })

  const axisProps = {
    tick: { fill: tick, fontSize },
    stroke: grid,
  }
  const chartMargin = { top: 8, right: 12, bottom: 4, left: -8 }

  let chart: React.ReactNode = null

  if (spec.type === 'pie' || spec.type === 'donut') {
    const s0 = series[0]
    const pieData = categories.map((cat, i) => ({ name: cat, value: s0?.values[i] ?? 0 }))
    const radius = Math.min(chartW, chartH) / 2 - (showLegend ? 24 : 8)
    chart = (
      <PieChart width={chartW} height={chartH}>
        <Pie
          data={pieData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={Math.max(20, radius)}
          innerRadius={spec.type === 'donut' ? Math.max(10, radius * 0.55) : 0}
          isAnimationActive={false}
          label={spec.showValues ? { fill: tick, fontSize } : false}
          stroke="none"
        >
          {pieData.map((_, i) => (
            // Pie/donut: one color PER SLICE from the palette — never the single
            // series color (that would paint every slice the same).
            <Cell key={i} fill={seriesColor(i)} />
          ))}
        </Pie>
        {showLegend && <Legend wrapperStyle={{ fontSize, color: tick }} />}
      </PieChart>
    )
  } else if (spec.type === 'line') {
    chart = (
      <LineChart width={chartW} height={chartH} data={rows} margin={chartMargin}>
        {showGrid && <CartesianGrid stroke={grid} strokeDasharray="3 3" />}
        <XAxis dataKey="name" {...axisProps} />
        <YAxis {...axisProps} />
        {showLegend && <Legend wrapperStyle={{ fontSize, color: tick }} />}
        {series.map((s, i) => (
          <Line
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={seriesColor(i, s.color)}
            strokeWidth={2}
            dot={{ r: 2.5 }}
            isAnimationActive={false}
          >
            {spec.showValues && <LabelList dataKey={s.name} position="top" fill={tick} fontSize={fontSize} />}
          </Line>
        ))}
      </LineChart>
    )
  } else if (spec.type === 'area') {
    chart = (
      <AreaChart width={chartW} height={chartH} data={rows} margin={chartMargin}>
        {showGrid && <CartesianGrid stroke={grid} strokeDasharray="3 3" />}
        <XAxis dataKey="name" {...axisProps} />
        <YAxis {...axisProps} />
        {showLegend && <Legend wrapperStyle={{ fontSize, color: tick }} />}
        {series.map((s, i) => (
          <Area
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stackId={spec.stacked ? 'stack' : undefined}
            stroke={seriesColor(i, s.color)}
            fill={seriesColor(i, s.color)}
            fillOpacity={0.35}
            strokeWidth={2}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    )
  } else if (spec.type === 'combo') {
    // Combo: each series draws as its own type (bar/line/area) and can be measured
    // against a left (primary) or right (secondary) axis — for metrics on different scales.
    const hasRight = series.some(s => s.axis === 'right')
    chart = (
      <ComposedChart width={chartW} height={chartH} data={rows} margin={chartMargin}>
        {showGrid && <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />}
        <XAxis dataKey="name" {...axisProps} />
        <YAxis yAxisId="left" {...axisProps} />
        {hasRight && <YAxis yAxisId="right" orientation="right" {...axisProps} />}
        {showLegend && <Legend wrapperStyle={{ fontSize, color: tick }} />}
        {series.map((s, i) => {
          const yAxisId = s.axis === 'right' ? 'right' : 'left'
          const color = seriesColor(i, s.color)
          const t: SeriesType = s.type ?? 'bar'
          if (t === 'line') {
            return (
              <Line
                key={s.name}
                yAxisId={yAxisId}
                type="monotone"
                dataKey={s.name}
                stroke={color}
                strokeWidth={2}
                dot={{ r: 2.5 }}
                isAnimationActive={false}
              >
                {spec.showValues && <LabelList dataKey={s.name} position="top" fill={tick} fontSize={fontSize} />}
              </Line>
            )
          }
          if (t === 'area') {
            return (
              <Area
                key={s.name}
                yAxisId={yAxisId}
                type="monotone"
                dataKey={s.name}
                stroke={color}
                fill={color}
                fillOpacity={0.35}
                strokeWidth={2}
                isAnimationActive={false}
              />
            )
          }
          return (
            <Bar
              key={s.name}
              yAxisId={yAxisId}
              dataKey={s.name}
              fill={color}
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            >
              {spec.showValues && <LabelList dataKey={s.name} position="top" fill={tick} fontSize={fontSize} />}
            </Bar>
          )
        })}
      </ComposedChart>
    )
  } else {
    // bar (default)
    chart = (
      <BarChart width={chartW} height={chartH} data={rows} margin={chartMargin}>
        {showGrid && <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />}
        <XAxis dataKey="name" {...axisProps} />
        <YAxis {...axisProps} />
        {showLegend && <Legend wrapperStyle={{ fontSize, color: tick }} />}
        {series.map((s, i) => (
          <Bar
            key={s.name}
            dataKey={s.name}
            stackId={spec.stacked ? 'stack' : undefined}
            fill={seriesColor(i, s.color)}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          >
            {spec.showValues && <LabelList dataKey={s.name} position="top" fill={tick} fontSize={fontSize} />}
          </Bar>
        ))}
      </BarChart>
    )
  }

  // Plot area sits inside the reserved title strips (padL/padR/padB); axis-title
  // overlays are drawn in those strips so they never overlap the plot or ticks.
  const axisTitleBase = {
    position: 'absolute' as const,
    color: tick,
    fontSize,
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden' as const,
    pointerEvents: 'none' as const,
  }

  return (
    <div style={{ width, height, overflow: 'hidden', pointerEvents: 'none', position: 'relative' }}>
      {spec.title && (
        <div
          style={{
            height: titleH,
            color: tick,
            fontSize: 13,
            fontWeight: 600,
            lineHeight: `${titleH}px`,
            textAlign: 'center',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {spec.title}
        </div>
      )}
      <div style={{ position: 'absolute', left: padL, top: titleH, width: chartW, height: chartH }}>
        {chart}
      </div>
      {yTitle && (
        <div
          style={{
            ...axisTitleBase,
            left: 0,
            top: titleH,
            width: AXIS_TITLE_STRIP,
            height: chartH,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}>{yTitle}</span>
        </div>
      )}
      {y2Title && (
        <div
          style={{
            ...axisTitleBase,
            right: 0,
            top: titleH,
            width: AXIS_TITLE_STRIP,
            height: chartH,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ transform: 'rotate(90deg)', transformOrigin: 'center' }}>{y2Title}</span>
        </div>
      )}
      {xTitle && (
        <div
          style={{
            ...axisTitleBase,
            left: padL,
            bottom: 0,
            width: chartW,
            height: AXIS_TITLE_STRIP,
            textAlign: 'center',
            lineHeight: `${AXIS_TITLE_STRIP}px`,
          }}
        >
          {xTitle}
        </div>
      )}
    </div>
  )
}
