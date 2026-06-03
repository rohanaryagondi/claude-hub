'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   /stats — INSTRUMENTS (FLIGHTDECK §6, priority #3: overall Claude stats).

   "How am I using Claude" overview as a fixed gauge cluster, NOT free-floating
   KPI cards (§7.6). A scope selector (7/30/90-day range) drives the whole
   cluster — the §7.5 "scope follows the lens" idea at the time-range altitude.

   Data:
     /api/stats?from=MM/DD/YYYY&to=MM/DD/YYYY  → headline KPIs, model mix,
        usage-over-time, tool load (range-scoped `computed` + `stats`).
     /api/activity                              → peak-hours-by-tokens, weekday,
        and the activity heatmap (global; the spec points peak-hours here).

   Every chart is handed resolved `--v2-*` hexes via useChartColors() so it
   renders correctly in dark (default) AND the `.light` "Day Deck".
   ═══════════════════════════════════════════════════════════════════════════ */

import * as React from 'react'
import useSWR from 'swr'
import { Gauge as GaugeIcon } from 'lucide-react'
import { V2Shell } from '@/components/v2/shell'
import {
  Panel,
  Section,
  StatTile,
  SkeletonRow,
  Pill,
} from '@/components/v2/ui'
import {
  categorizeTool,
  CATEGORY_LABELS,
  type ToolCategory,
} from '@/lib/tool-categories'
import {
  UsageOverTime,
  ModelMix,
  PeakHours,
  ToolLoad,
  DayOfWeek,
  ActivityHeatmap,
  type UsagePoint,
  type ModelSlice,
  type HourPoint,
  type ToolLoadRow,
  type DowRow,
  type HeatDay,
} from '@/components/v2/chart-instruments'
import { fmtTokens, fmtCost, fmtInt } from '@/components/v2/chart-theme'

const fetcher = (u: string) => fetch(u).then((r) => r.json())

/* ── range presets ─────────────────────────────────────────────────────────── */
type RangeKey = '7' | '30' | '90'
const RANGES: { key: RangeKey; label: string; days: number }[] = [
  { key: '7', label: '7D', days: 7 },
  { key: '30', label: '30D', days: 30 },
  { key: '90', label: '90D', days: 90 },
]

function mmddyyyy(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}/${dd}/${d.getFullYear()}`
}

/* ── API shapes (only the fields we read) ──────────────────────────────────── */
interface DailyActivity {
  date: string
  messageCount: number
  sessionCount: number
  toolCallCount: number
  tokenCount?: number
}
interface ModelUsage {
  inputTokens?: number
  outputTokens?: number
}
interface StatsResponse {
  stats: {
    dailyActivity: DailyActivity[]
    modelUsage: Record<string, ModelUsage>
  }
  computed: {
    totalCost: number
    totalInputTokens: number
    totalOutputTokens: number
    totalToolCalls: number
    sessionCount: number
    activeDays?: number
    totalCacheSavings?: number
    totalCacheReadTokens?: number
  }
}
interface ActivityResponse {
  daily_activity: DailyActivity[]
  hour_counts: { hour: number; count: number }[]
  dow_counts: { day: string; count: number }[]
  streaks: { current: number; longest: number }
  most_active_day: string
  most_active_day_tokens: number
  total_active_days?: number
}
interface ProjectsResponse {
  projects: { tool_counts?: Record<string, number> }[]
}

export default function V2StatsPage() {
  const [range, setRange] = React.useState<RangeKey>('30')

  const { from, to, days } = React.useMemo(() => {
    const preset = RANGES.find((r) => r.key === range)!
    const toD = new Date()
    const fromD = new Date()
    fromD.setDate(toD.getDate() - (preset.days - 1))
    return { from: mmddyyyy(fromD), to: mmddyyyy(toD), days: preset.days }
  }, [range])

  const stats = useSWR<StatsResponse>(`/api/stats?from=${from}&to=${to}`, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
  const activity = useSWR<ActivityResponse>('/api/activity', fetcher, {
    revalidateOnFocus: false,
  })
  // /api/projects carries the only per-tool breakdown (tool_counts). All-time.
  const projects = useSWR<ProjectsResponse>('/api/projects', fetcher, {
    revalidateOnFocus: false,
  })

  const loading = !stats.data && !stats.error
  const c = stats.data?.computed
  const s = stats.data?.stats

  /* ── derive headline KPIs (range-scoped) ─────────────────────────────────── */
  const kpi = React.useMemo(() => {
    if (!c || !s) return null
    const ioTokens = (c.totalInputTokens ?? 0) + (c.totalOutputTokens ?? 0)
    const messages = s.dailyActivity.reduce((a, d) => a + (d.messageCount ?? 0), 0)
    const sessions = c.sessionCount ?? 0
    const toolCalls = c.totalToolCalls ?? 0
    const activeDays = s.dailyActivity.filter((d) => (d.sessionCount ?? 0) > 0).length
    // tokens here are i/o only; the heatmap/throughput key off per-day tokenCount.
    const tokenDays = s.dailyActivity.reduce((a, d) => a + (d.tokenCount ?? 0), 0)
    const cacheRead = c.totalCacheReadTokens ?? 0
    const cacheBase = cacheRead + (c.totalInputTokens ?? 0)
    return {
      sessions,
      messages,
      tokens: ioTokens,
      cost: c.totalCost ?? 0,
      toolCalls,
      activeDays,
      // derived rates (fill the readout band, keep it glanceable)
      tokensPerDay: activeDays ? Math.round(tokenDays / activeDays) : 0,
      toolsPerSession: sessions ? toolCalls / sessions : 0,
      cacheSaved: c.totalCacheSavings ?? 0,
      cacheHit: cacheBase > 0 ? cacheRead / cacheBase : 0,
    }
  }, [c, s])

  // throughput sparkline for the headline tile (per-day i/o token volume)
  const tokenSpark = React.useMemo(
    () => (s ? s.dailyActivity.map((d) => d.tokenCount ?? 0) : []),
    [s],
  )

  /* ── usage over time (tokens i/o per day) ────────────────────────────────── */
  const usage: UsagePoint[] = React.useMemo(() => {
    if (!s) return []
    return s.dailyActivity.map((d) => ({
      date: d.date,
      tokens: d.tokenCount ?? 0,
      sessions: d.sessionCount ?? 0,
    }))
  }, [s])

  /* ── model mix (input+output tokens per model, range-scoped) ─────────────── */
  const models: ModelSlice[] = React.useMemo(() => {
    if (!s?.modelUsage) return []
    return Object.entries(s.modelUsage)
      .map(([id, u]) => ({ id, tokens: (u.inputTokens ?? 0) + (u.outputTokens ?? 0) }))
      .filter((m) => m.id !== '<synthetic>' && m.tokens > 0)
  }, [s])

  /* ── tool load — aggregate /api/projects tool_counts by category (all-time;
        /api/stats exposes no per-tool breakdown). ──────────────────────────── */
  const toolLoad: ToolLoadRow[] = React.useMemo(() => {
    const ps = projects.data?.projects ?? []
    if (!ps.length) return []
    const byCat = new Map<ToolCategory, number>()
    for (const p of ps) {
      for (const [name, n] of Object.entries(p.tool_counts ?? {})) {
        const cat = categorizeTool(name)
        byCat.set(cat, (byCat.get(cat) ?? 0) + (n ?? 0))
      }
    }
    return Array.from(byCat.entries()).map(([cat, count]) => ({
      cat,
      label: CATEGORY_LABELS[cat],
      count,
    }))
  }, [projects.data])

  /* ── peak hours by tokens (from /api/activity hour_counts = tokens) ──────── */
  const hours: HourPoint[] = React.useMemo(() => {
    const hc = activity.data?.hour_counts ?? []
    const map = new Map(hc.map((h) => [h.hour, h.count]))
    return Array.from({ length: 24 }, (_, h) => ({ hour: h, tokens: map.get(h) ?? 0 }))
  }, [activity.data])

  const dow: DowRow[] = React.useMemo(() => activity.data?.dow_counts ?? [], [activity.data])

  const heat: HeatDay[] = React.useMemo(() => {
    return (activity.data?.daily_activity ?? [])
      .filter((d) => (d.tokenCount ?? 0) > 0)
      .map((d) => ({ date: d.date, tokens: d.tokenCount ?? 0 }))
  }, [activity.data])

  const monthLabel = (mmdd: string) => {
    const [mm, dd] = mmdd.split('/')
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
      Number(mm) - 1
    ]
    return `${mo} ${Number(dd)}`
  }

  const dek =
    kpi && !loading
      ? `${fmtInt(kpi.sessions)} sessions · ${fmtInt(kpi.tokens)} tokens · ${monthLabel(from)}–${monthLabel(to)}`
      : `loading instruments · last ${days} days`

  return (
    <V2Shell active="stats">
      <div style={{ padding: 'var(--v2-s4)', display: 'flex', flexDirection: 'column', gap: 'var(--v2-s4)' }}>
        {/* ── canopy header + range scope selector ──────────────────────────── */}
        <Section
          eyebrow="INSTRUMENTS"
          title="Overall Claude usage"
          dek={dek}
          actions={<RangeSelector range={range} onChange={setRange} />}
        />

        {/* ── lead KPI readout band — distributed across the FULL width ─────── */}
        <Panel eyebrow="READOUT" title="Headline" headerRight={<ScopeChip days={days} />}>
          {loading ? (
            <KpiSkeleton />
          ) : (
            <div
              className="grid gap-x-5 gap-y-4"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))' }}
            >
              <StatTile
                size="lead"
                label="Sessions"
                value={fmtInt(kpi?.sessions ?? 0)}
                sub={`${fmtInt(kpi?.activeDays ?? 0)} active days`}
              />
              <StatTile
                size="lead"
                label="Messages"
                value={fmtInt(kpi?.messages ?? 0)}
                sub={`${fmtInt(kpi?.toolCalls ?? 0)} tool calls`}
              />
              <StatTile
                size="lead"
                label="Tokens (i/o)"
                value={fmtTokens(kpi?.tokens ?? 0)}
                tone="token"
                sub="input + output"
                spark={tokenSpark.length > 1 ? tokenSpark : undefined}
                sparkProps={{ tone: 'token', height: 20 }}
              />
              <StatTile
                size="lead"
                label="Est. cost"
                value={fmtCost(kpi?.cost ?? 0)}
                tone="cost"
                sub={`over ${days} days`}
              />
              <StatTile
                size="lead"
                label="Cache saved"
                value={fmtCost(kpi?.cacheSaved ?? 0)}
                tone="default"
                sub={`${Math.round((kpi?.cacheHit ?? 0) * 100)}% cache hit`}
              />
              <StatTile
                size="lead"
                label="Tokens / day"
                value={fmtTokens(kpi?.tokensPerDay ?? 0)}
                sub="active-day avg"
              />
              <StatTile
                size="lead"
                label="Tools / session"
                value={(kpi?.toolsPerSession ?? 0).toFixed(1)}
                tone="accent"
                sub={`${fmtInt(kpi?.toolCalls ?? 0)} calls`}
              />
            </div>
          )}
        </Panel>

        {/* ── throughput (wide) + model mix (compact, beside it) ────────────── */}
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'minmax(0, 2.1fr) minmax(280px, 1fr)' }}
        >
          <Panel eyebrow="THROUGHPUT" title="Usage over time" headerRight={<MonoNote>tokens / day</MonoNote>}>
            {loading ? <ChartSkeleton height={168} /> : <UsageOverTime data={usage} />}
          </Panel>

          <Panel eyebrow="MODEL MIX" title="Which models" headerRight={<MonoNote>by tokens (i/o)</MonoNote>}>
            {loading ? <ChartSkeleton height={120} /> : <ModelMix data={models} />}
          </Panel>
        </div>

        {/* ── peak hours + tool load + rhythm — dense 3-up filling the width ── */}
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}
        >
          <Panel eyebrow="PEAK HOURS" title="Hour of day" headerRight={<MonoNote>tokens / hour</MonoNote>}>
            {activity.isLoading && !activity.data ? (
              <ChartSkeleton height={156} />
            ) : (
              <PeakHours data={hours} />
            )}
          </Panel>

          <Panel
            eyebrow="TOOL LOAD"
            title="What Claude runs"
            headerRight={<MonoNote>calls by category</MonoNote>}
          >
            {projects.isLoading && !projects.data ? (
              <ChartSkeleton height={140} />
            ) : toolLoad.length ? (
              <ToolLoad data={toolLoad} />
            ) : (
              <FallbackNote>
                tool breakdown unavailable · {fmtInt(kpi?.toolCalls ?? 0)} calls this range
              </FallbackNote>
            )}
          </Panel>

          <Panel eyebrow="RHYTHM" title="Day of week" headerRight={<MonoNote>sessions / weekday</MonoNote>}>
            {activity.isLoading && !activity.data ? <ChartSkeleton height={140} /> : <DayOfWeek data={dow} height={140} />}
          </Panel>
        </div>

        {/* ── activity heatmap (full width, all-time) ───────────────────────── */}
        <Panel
          eyebrow="CALENDAR"
          title="Activity heatmap"
          headerRight={
            activity.data ? (
              <div className="flex items-center gap-2">
                <Pill variant="live" dot>
                  {activity.data.streaks?.current ?? 0}d streak
                </Pill>
                <MonoNote>
                  peak {monthLabel(toMMDD(activity.data.most_active_day))} ·{' '}
                  {fmtTokens(activity.data.most_active_day_tokens ?? 0)}
                </MonoNote>
              </div>
            ) : null
          }
        >
          {activity.isLoading && !activity.data ? <ChartSkeleton height={120} /> : <ActivityHeatmap data={heat} />}
        </Panel>
      </div>
    </V2Shell>
  )
}

/* ── YYYY-MM-DD → MM/DD for the monthLabel helper ───────────────────────────── */
function toMMDD(iso: string): string {
  if (!iso) return '01/01'
  const [, mm, dd] = iso.split('-')
  return `${mm}/${dd}`
}

/* ═══════════════════════════════════════════════════════════════════════════
   Local UI bits
   ═══════════════════════════════════════════════════════════════════════════ */

function RangeSelector({ range, onChange }: { range: RangeKey; onChange: (r: RangeKey) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Time range"
      className="inline-flex items-center"
      style={{
        background: 'var(--v2-surface-2)',
        border: '1px solid var(--v2-border)',
        borderRadius: 'var(--v2-radius-sm)',
        padding: 2,
        gap: 2,
      }}
    >
      {RANGES.map((r) => {
        const active = r.key === range
        return (
          <button
            key={r.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(r.key)}
            className="transition-colors"
            style={{
              fontFamily: 'var(--v2-font-mono)',
              fontSize: 'var(--v2-text-micro)',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: 'var(--v2-radius-sm)',
              background: active ? 'var(--v2-accent)' : 'transparent',
              color: active ? 'var(--v2-accent-fg)' : 'var(--v2-muted)',
              transitionDuration: 'var(--v2-dur)',
              transitionTimingFunction: 'var(--v2-ease)',
            }}
          >
            {r.label}
          </button>
        )
      })}
    </div>
  )
}

function ScopeChip({ days }: { days: number }) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{
        fontFamily: 'var(--v2-font-mono)',
        fontSize: 'var(--v2-text-micro)',
        color: 'var(--v2-faint)',
      }}
    >
      <GaugeIcon size={12} style={{ color: 'var(--v2-accent)' }} />
      scoped: last {days}d
    </span>
  )
}

function MonoNote({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: 'var(--v2-font-mono)',
        fontSize: 'var(--v2-text-micro)',
        color: 'var(--v2-faint)',
      }}
    >
      {children}
    </span>
  )
}

function FallbackNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center"
      style={{
        minHeight: 80,
        fontFamily: 'var(--v2-font-mono)',
        fontSize: 'var(--v2-text-micro)',
        color: 'var(--v2-muted)',
      }}
    >
      {children}
    </div>
  )
}

function KpiSkeleton() {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <SkeletonRow height={12} width="50%" />
          <SkeletonRow height={28} width="70%" />
          <SkeletonRow height={12} width="40%" />
        </div>
      ))}
    </div>
  )
}

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div className="flex flex-col justify-end gap-1.5" style={{ height }}>
      {[0.4, 0.7, 0.5, 0.85, 0.6, 0.95].map((w, i) => (
        <SkeletonRow key={i} height={Math.max(8, height / 10)} width={`${w * 100}%`} />
      ))}
    </div>
  )
}
