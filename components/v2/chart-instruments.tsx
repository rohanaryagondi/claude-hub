'use client'

import * as React from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import {
  useChartColors,
  type ChartColors,
  toolCategoryColor,
  type ToolCat,
  fmtTokens,
  fmtInt,
  fmtCost,
  prettyModel,
  modelColor,
} from './chart-theme'

/* ═══════════════════════════════════════════════════════════════════════════
   INSTRUMENTS gauges — FLIGHTDECK §6 / §7.6 "honest instruments, reserved
   color." Every chart is handed resolved `--v2-*` hexes (Recharts can't read
   CSS vars). No pie charts; no decorative gradients except the one sanctioned
   burn-rate token→cost area fill.
   ═══════════════════════════════════════════════════════════════════════════ */

const FONT_MONO = 'var(--v2-font-mono)'

/* ── shared tooltip shell ──────────────────────────────────────────────────── */
function TipBox({
  c,
  title,
  rows,
}: {
  c: ChartColors
  title: string
  rows: { label: string; value: string; color?: string }[]
}) {
  return (
    <div
      style={{
        background: c['surface-3'],
        border: `1px solid ${c['border-2']}`,
        borderRadius: 6,
        padding: '8px 10px',
        boxShadow: '0 4px 16px rgba(0,0,0,.35)',
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 11,
          color: c.muted,
          marginBottom: 4,
          letterSpacing: '.02em',
        }}
      >
        {title}
      </div>
      {rows.map((r, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            justifyContent: 'space-between',
            fontFamily: FONT_MONO,
            fontSize: 12,
            fontVariantNumeric: 'tabular-nums',
            color: c.text,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {r.color && (
              <span
                style={{ width: 8, height: 8, borderRadius: 2, background: r.color, display: 'inline-block' }}
              />
            )}
            <span style={{ color: c.muted }}>{r.label}</span>
          </span>
          <span style={{ fontWeight: 600 }}>{r.value}</span>
        </div>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. USAGE OVER TIME — tokens (input+output) per day, area chart with the
   sanctioned burn-rate gradient + a moving "now" reference on the last day.
   ═══════════════════════════════════════════════════════════════════════════ */
export interface UsagePoint {
  date: string // YYYY-MM-DD
  tokens: number
  sessions: number
}

export function UsageOverTime({ data, height = 168 }: { data: UsagePoint[]; height?: number }) {
  const c = useChartColors()
  const gradId = React.useId().replace(/:/g, '')

  if (!data.length) return <EmptyChart c={c} height={height} label="no token activity in range" />

  const fmtTick = (d: string) => {
    // YYYY-MM-DD → "Mon DD" terse
    const parts = d.split('-')
    if (parts.length !== 3) return d
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
      Number(parts[1]) - 1
    ]
    return `${mo} ${Number(parts[2])}`
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 6 }}>
        <defs>
          <linearGradient id={`fill-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c['spark-to']} stopOpacity={0.45} />
            <stop offset="100%" stopColor={c['spark-from']} stopOpacity={0.04} />
          </linearGradient>
          <linearGradient id={`stroke-${gradId}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={c['spark-from']} />
            <stop offset="100%" stopColor={c['spark-to']} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={c.border} strokeDasharray="0" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={fmtTick}
          tick={{ fill: c.faint, fontSize: 10, fontFamily: FONT_MONO }}
          axisLine={{ stroke: c.border }}
          tickLine={false}
          minTickGap={28}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={(v) => fmtTokens(v as number)}
          tick={{ fill: c.faint, fontSize: 10, fontFamily: FONT_MONO }}
          axisLine={false}
          tickLine={false}
          width={54}
        />
        <Tooltip
          cursor={{ stroke: c['border-2'], strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as UsagePoint
            return (
              <TipBox
                c={c}
                title={fmtTick(p.date)}
                rows={[
                  { label: 'tokens', value: fmtTokens(p.tokens), color: c.token },
                  { label: 'sessions', value: fmtInt(p.sessions), color: c.accent },
                ]}
              />
            )
          }}
        />
        <Area
          type="monotone"
          dataKey="tokens"
          stroke={`url(#stroke-${gradId})`}
          strokeWidth={1.6}
          fill={`url(#fill-${gradId})`}
          isAnimationActive={false}
          dot={false}
          activeDot={{ r: 3, fill: c.text, stroke: 'none' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. MODEL MIX — a single horizontal stacked bar (NOT a pie), with a legend of
   per-model token shares. input+output tokens per model.
   ═══════════════════════════════════════════════════════════════════════════ */
export interface ModelSlice {
  id: string
  tokens: number
}

export function ModelMix({ data }: { data: ModelSlice[] }) {
  const c = useChartColors()
  const slices = data.filter((d) => d.tokens > 0).sort((a, b) => b.tokens - a.tokens)
  const total = slices.reduce((s, d) => s + d.tokens, 0)

  if (!total) return <EmptyChart c={c} height={96} label="no model usage in range" />

  const lead = slices[0]
  const leadPct = (lead.tokens / total) * 100

  return (
    <div className="flex flex-col gap-2.5">
      {/* the single stacked share bar */}
      <div
        style={{
          display: 'flex',
          height: 12,
          borderRadius: 4,
          overflow: 'hidden',
          background: c['surface-2'],
          border: `1px solid ${c.border}`,
        }}
      >
        {slices.map((s) => {
          const pct = (s.tokens / total) * 100
          return (
            <div
              key={s.id}
              title={`${prettyModel(s.id)} — ${pct.toFixed(1)}%`}
              style={{
                width: `${pct}%`,
                background: modelColor(s.id, c),
                minWidth: pct > 0 ? 2 : 0,
              }}
            />
          )
        })}
      </div>

      {/* glanceable: dominant model + its share */}
      <div className="flex items-baseline justify-between" style={{ marginTop: -1 }}>
        <span
          style={{ fontFamily: 'var(--v2-font-sans)', fontSize: 12, color: c.muted }}
        >
          mostly{' '}
          <span style={{ color: modelColor(lead.id, c), fontWeight: 600 }}>{prettyModel(lead.id)}</span>
        </span>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 12,
            fontVariantNumeric: 'tabular-nums',
            color: c.faint,
          }}
        >
          {leadPct.toFixed(0)}% of {fmtTokens(total)}
        </span>
      </div>

      {/* compact legend rows */}
      <div className="flex flex-col" style={{ gap: 5 }}>
        {slices.map((s) => {
          const pct = (s.tokens / total) * 100
          return (
            <div key={s.id} className="flex items-center gap-2">
              <span
                style={{ width: 7, height: 7, borderRadius: 2, background: modelColor(s.id, c), flexShrink: 0 }}
              />
              <span
                style={{
                  fontFamily: 'var(--v2-font-sans)',
                  fontSize: 12.5,
                  color: c.text,
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {prettyModel(s.id)}
              </span>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11.5,
                  fontVariantNumeric: 'tabular-nums',
                  color: c.muted,
                }}
              >
                {fmtTokens(s.tokens)}
              </span>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11.5,
                  fontVariantNumeric: 'tabular-nums',
                  color: c.faint,
                  width: 44,
                  textAlign: 'right',
                }}
              >
                {pct.toFixed(1)}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   2b. BY PROJECT — token volume + estimated cost per project. A ranked bar list
   (token = blue, cost = red) answering "where is my usage / spend going". The
   bar length is proportional to the busiest project's tokens.
   ═══════════════════════════════════════════════════════════════════════════ */
export interface ProjectStat {
  name: string
  tokens: number
  cost: number
}

export function ProjectBreakdown({ data, limit = 7 }: { data: ProjectStat[]; limit?: number }) {
  const c = useChartColors()
  const all = data.filter((d) => d.tokens > 0).sort((a, b) => b.tokens - a.tokens)
  if (!all.length) return <EmptyChart c={c} height={120} label="no project usage in range" />
  const rows = all.slice(0, limit)
  const max = rows[0].tokens
  const extra = all.length - rows.length

  return (
    <div className="flex flex-col" style={{ gap: 7 }}>
      {rows.map((p) => {
        const pct = max > 0 ? (p.tokens / max) * 100 : 0
        return (
          <div key={p.name} className="flex flex-col" style={{ gap: 2.5 }}>
            <div className="flex items-baseline gap-1.5">
              <span
                title={p.name}
                style={{
                  fontFamily: 'var(--v2-font-sans)',
                  fontSize: 12,
                  color: c.text,
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {p.name}
              </span>
              <span
                style={{ fontFamily: FONT_MONO, fontSize: 11, fontVariantNumeric: 'tabular-nums', color: c.token }}
              >
                {fmtTokens(p.tokens)}
              </span>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  fontVariantNumeric: 'tabular-nums',
                  color: c.cost,
                  width: 56,
                  textAlign: 'right',
                }}
              >
                {fmtCost(p.cost)}
              </span>
            </div>
            <div style={{ height: 5, borderRadius: 3, background: c['surface-2'], overflow: 'hidden' }}>
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: c.token,
                  minWidth: pct > 0 ? 2 : 0,
                  borderRadius: 3,
                }}
              />
            </div>
          </div>
        )
      })}
      {extra > 0 && (
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10.5,
            color: c.faint,
            paddingTop: 1,
          }}
        >
          +{extra} more {extra === 1 ? 'project' : 'projects'}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. PEAK HOURS — a plain 24-hour hour-of-day bar chart (x = 0..23, y = tokens).
   Replaces the old radial dial: a Cartesian bar reads instantly. The single
   peak hour is highlighted in --v2-accent; every other bar is --v2-token. Terse
   x-ticks (12a / 6a / 12p / 6p / 12a) keep the axis legible at ~150px.
   ═══════════════════════════════════════════════════════════════════════════ */
export interface HourPoint {
  hour: number
  tokens: number
}

/** 0→12a, 6→6a, 12→12p, 18→6p, 23→11p — terse, am/pm hour labels. */
function hourLabel(h: number): string {
  if (h === 0) return '12a'
  if (h === 12) return '12p'
  return h < 12 ? `${h}a` : `${h - 12}p`
}

export function PeakHours({ data, height = 156 }: { data: HourPoint[]; height?: number }) {
  const c = useChartColors()
  const peak = data.reduce((best, d) => (d.tokens > best.tokens ? d : best), { hour: 0, tokens: 0 })

  if (!data.some((d) => d.tokens > 0)) return <EmptyChart c={c} height={height} label="no hourly data" />

  // Only label a few anchor hours so ticks never collide at narrow widths.
  const anchorTicks = [0, 6, 12, 18]
  const fmtTick = (h: number) => (anchorTicks.includes(h) ? hourLabel(h) : '')

  return (
    <div className="flex flex-col gap-1.5">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 4 }} barCategoryGap={2}>
          <CartesianGrid stroke={c.border} strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="hour"
            type="category"
            tickFormatter={(h) => fmtTick(h as number)}
            tick={{ fill: c.faint, fontSize: 10, fontFamily: FONT_MONO }}
            axisLine={{ stroke: c.border }}
            tickLine={false}
            interval={0}
            minTickGap={0}
          />
          <YAxis
            tickFormatter={(v) => fmtTokens(v as number)}
            tick={{ fill: c.faint, fontSize: 10, fontFamily: FONT_MONO }}
            axisLine={false}
            tickLine={false}
            width={42}
          />
          <Tooltip
            cursor={{ fill: c['accent-weak'] }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as HourPoint
              const isPeak = p.hour === peak.hour
              return (
                <TipBox
                  c={c}
                  title={`${String(p.hour).padStart(2, '0')}:00 – ${String((p.hour + 1) % 24).padStart(2, '0')}:00`}
                  rows={[
                    { label: 'tokens', value: fmtTokens(p.tokens), color: isPeak ? c.accent : c.token },
                    ...(isPeak ? [{ label: 'peak hour', value: hourLabel(p.hour) }] : []),
                  ]}
                />
              )
            }}
          />
          <Bar dataKey="tokens" isAnimationActive={false} radius={[2, 2, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.hour} fill={d.hour === peak.hour ? c.accent : c.token} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {/* glanceable footnote: the peak hour, called out in accent */}
      <div
        className="flex items-center justify-between"
        style={{ fontFamily: FONT_MONO, fontSize: 11, color: c.faint }}
      >
        <span>tokens by local hour</span>
        <span>
          peak{' '}
          <span style={{ color: c.accent, fontWeight: 600 }}>{hourLabel(peak.hour)}</span> ·{' '}
          {fmtTokens(peak.tokens)}
        </span>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. TOOL LOAD — horizontal bars per tool category, value = call count.
   ═══════════════════════════════════════════════════════════════════════════ */
export interface ToolLoadRow {
  cat: ToolCat
  label: string
  count: number
}

export function ToolLoad({ data }: { data: ToolLoadRow[] }) {
  const c = useChartColors()
  const rows = data.filter((d) => d.count > 0).sort((a, b) => b.count - a.count)
  const max = Math.max(1, ...rows.map((r) => r.count))

  if (!rows.length) return <EmptyChart c={c} height={120} label="no tool calls in range" />

  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => {
        const color = toolCategoryColor(r.cat, c)
        const pct = (r.count / max) * 100
        return (
          <div key={r.cat} className="flex items-center gap-3">
            <span
              style={{
                width: 64,
                flexShrink: 0,
                fontFamily: 'var(--v2-font-sans)',
                fontSize: 12,
                color: c.muted,
                textAlign: 'right',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {r.label}
            </span>
            <div
              style={{
                flex: 1,
                height: 16,
                background: c['surface-2'],
                borderRadius: 3,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: color,
                  borderRadius: 3,
                  minWidth: 2,
                  transition: 'width var(--v2-dur) var(--v2-ease)',
                }}
              />
            </div>
            <span
              style={{
                width: 56,
                flexShrink: 0,
                fontFamily: FONT_MONO,
                fontSize: 12,
                fontVariantNumeric: 'tabular-nums',
                color: c.text,
                textAlign: 'right',
              }}
            >
              {fmtInt(r.count)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. DAY-OF-WEEK — 7 vertical bars, value = session count by weekday.
   ═══════════════════════════════════════════════════════════════════════════ */
export interface DowRow {
  day: string
  count: number
}

export function DayOfWeek({ data, height = 120 }: { data: DowRow[]; height?: number }) {
  const c = useChartColors()
  const max = Math.max(1, ...data.map((d) => d.count))
  const busiest = data.reduce((b, d) => (d.count > b.count ? d : b), { day: '', count: 0 })

  if (!data.some((d) => d.count > 0)) return <EmptyChart c={c} height={height} label="no weekday data" />

  return (
    <div className="flex items-end justify-between gap-2" style={{ height }}>
      {data.map((d) => {
        const h = (d.count / max) * (height - 22)
        const isBusiest = d.day === busiest.day
        return (
          <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5" style={{ minWidth: 0 }}>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                fontVariantNumeric: 'tabular-nums',
                color: isBusiest ? c.accent : c.faint,
              }}
            >
              {d.count}
            </span>
            <div
              title={`${d.day}: ${d.count} sessions`}
              style={{
                width: '100%',
                maxWidth: 32,
                height: Math.max(2, h),
                background: isBusiest ? c.accent : c.token,
                opacity: isBusiest ? 1 : 0.8,
                borderRadius: 3,
              }}
            />
            <span
              style={{
                fontFamily: 'var(--v2-font-sans)',
                fontSize: 11,
                color: c.muted,
              }}
            >
              {d.day}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. ACTIVITY HEATMAP — GitHub-style calendar grid, one cell per day, intensity
   = tokens that day. Weeks as columns; weekday rows. Uses token-hue ramp.
   ═══════════════════════════════════════════════════════════════════════════ */
export interface HeatDay {
  date: string // YYYY-MM-DD
  tokens: number
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function ActivityHeatmap({ data }: { data: HeatDay[] }) {
  const c = useChartColors()

  const { weeks, max, monthLabels } = React.useMemo(() => buildHeatGrid(data), [data])
  if (!weeks.length) return <EmptyChart c={c} height={120} label="no daily activity" />

  // 5-step token-hue ramp (transparent → full token blue) via color-mix.
  const rampFor = (tokens: number): string => {
    if (tokens <= 0) return c['surface-2']
    const t = Math.min(1, tokens / max)
    const pct = 20 + Math.round(t * 80) // 20%..100%
    return `color-mix(in srgb, ${c.token} ${pct}%, ${c['surface-2']})`
  }

  // Cells stretch to fill the column width: each week is a flex:1 column and each
  // cell is square via aspect-ratio, so the grid grows to whatever width it's given
  // (no fixed pixel grid leaving blank space in a wide panel).
  const GAP = 4
  const LABEL_W = 26

  return (
    <div className="flex w-full flex-col gap-2">
      {/* month labels */}
      <div className="flex w-full" style={{ paddingLeft: LABEL_W + GAP, gap: GAP }}>
        {weeks.map((_, wi) => (
          <div key={wi} style={{ flex: '1 1 0', minWidth: 0, position: 'relative', height: 12 }}>
            {monthLabels[wi] && (
              <span
                style={{
                  position: 'absolute',
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  color: c.faint,
                  whiteSpace: 'nowrap',
                }}
              >
                {monthLabels[wi]}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="flex w-full" style={{ gap: GAP }}>
        {/* weekday labels (alternating) — flex children align 1:1 with cell rows */}
        <div className="flex flex-col" style={{ width: LABEL_W, gap: GAP }}>
          {WEEKDAYS.map((d, i) => (
            <span
              key={d}
              className="flex items-center"
              style={{
                flex: '1 1 0',
                fontFamily: FONT_MONO,
                fontSize: 9,
                color: c.faint,
                visibility: i % 2 === 1 ? 'visible' : 'hidden',
              }}
            >
              {d}
            </span>
          ))}
        </div>

        {/* week columns */}
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col" style={{ flex: '1 1 0', minWidth: 0, gap: GAP }}>
            {week.map((day, di) => (
              <div
                key={di}
                title={day ? `${day.date}: ${fmtTokens(day.tokens)} tokens` : undefined}
                style={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  borderRadius: 2.5,
                  background: day ? rampFor(day.tokens) : 'transparent',
                  border: day && day.tokens > 0 ? 'none' : day ? `1px solid ${c.border}` : 'none',
                }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* legend — below the grid, right-aligned, so it never steals grid width */}
      <div className="flex items-center justify-end gap-1 pt-0.5">
        <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: c.faint }}>less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <span
            key={t}
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background:
                t === 0
                  ? c['surface-2']
                  : `color-mix(in srgb, ${c.token} ${20 + Math.round(t * 80)}%, ${c['surface-2']})`,
              border: t === 0 ? `1px solid ${c.border}` : 'none',
            }}
          />
        ))}
        <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: c.faint }}>more</span>
      </div>
    </div>
  )
}

/* Build a weeks[] × 7 grid (Sun-first) from a sparse daily list. */
function buildHeatGrid(data: HeatDay[]) {
  if (!data.length) return { weeks: [] as (HeatDay | null)[][], max: 1, monthLabels: [] as (string | null)[] }

  const byDate = new Map<string, number>()
  for (const d of data) byDate.set(d.date, d.tokens)

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date))
  const start = new Date(sorted[0].date + 'T00:00:00')
  const end = new Date(sorted[sorted.length - 1].date + 'T00:00:00')

  // back up to the Sunday on/before start
  const gridStart = new Date(start)
  gridStart.setDate(gridStart.getDate() - gridStart.getDay())

  const max = Math.max(1, ...data.map((d) => d.tokens))
  const weeks: (HeatDay | null)[][] = []
  const monthLabels: (string | null)[] = []
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  const cursor = new Date(gridStart)
  let lastMonth = -1
  while (cursor <= end) {
    const week: (HeatDay | null)[] = []
    let weekMonthLabel: string | null = null
    for (let d = 0; d < 7; d++) {
      const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(
        cursor.getDate()
      ).padStart(2, '0')}`
      const inRange = cursor >= start && cursor <= end
      week.push(inRange ? { date: iso, tokens: byDate.get(iso) ?? 0 } : null)
      if (d === 0 && cursor.getMonth() !== lastMonth && cursor <= end) {
        weekMonthLabel = MONTHS[cursor.getMonth()]
        lastMonth = cursor.getMonth()
      }
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
    monthLabels.push(weekMonthLabel)
  }
  return { weeks, max, monthLabels }
}

/* ── shared empty state ────────────────────────────────────────────────────── */
function EmptyChart({ c, height, label }: { c: ChartColors; height: number; label: string }) {
  return (
    <div
      className="flex items-center justify-center"
      style={{
        height,
        border: `1px dashed ${c.border}`,
        borderRadius: 6,
        color: c.faint,
        fontFamily: FONT_MONO,
        fontSize: 12,
      }}
    >
      {label}
    </div>
  )
}
