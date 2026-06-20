'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   /stats — INSTRUMENTS (FLIGHTDECK §6, priority #3: overall Claude stats).

   "How am I using Claude" overview as a fixed gauge cluster, NOT free-floating
   KPI cards (§7.6). A scope selector (1-day / 7 / 30 / All-time range) drives the
   whole cluster — the §7.5 "scope follows the lens" idea at the time-range altitude.

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
import { V2Shell } from '@/components/v2/shell'
import {
  Panel,
  Section,
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
  ProjectBreakdown,
  PeakHours,
  ToolLoad,
  DayOfWeek,
  ActivityHeatmap,
  type UsagePoint,
  type ModelSlice,
  type ProjectStat,
  type HourPoint,
  type ToolLoadRow,
  type DowRow,
  type HeatDay,
} from '@/components/v2/chart-instruments'
import { fmtTokens, fmtCost, fmtInt } from '@/components/v2/chart-theme'

const fetcher = (u: string) => fetch(u).then((r) => r.json())

/* ── range presets ─────────────────────────────────────────────────────────── */
type RangeKey = '1' | '7' | '30' | 'all'
const RANGES: { key: RangeKey; label: string; days: number }[] = [
  { key: '1', label: '1D', days: 1 },
  { key: '7', label: '7D', days: 7 },
  { key: '30', label: '30D', days: 30 },
  { key: 'all', label: 'All', days: 0 }, // 0 = all time (no date filter)
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
    projectBreakdown?: ProjectStat[]
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
  // /api/projects is now used only for the all-time per-tool breakdown (TOOL LOAD);
  // per-project tokens/cost moved to the range-scoped /api/stats `projectBreakdown`.
  projects: {
    tool_counts?: Record<string, number>
  }[]
}

export default function V2StatsPage() {
  const [range, setRange] = React.useState<RangeKey>('30')

  const { from, to, days } = React.useMemo(() => {
    const preset = RANGES.find((r) => r.key === range)!
    if (range === 'all') return { from: '', to: '', days: 0 } // no date filter → all-time
    const toD = new Date()
    const fromD = new Date()
    fromD.setDate(toD.getDate() - (preset.days - 1))
    return { from: mmddyyyy(fromD), to: mmddyyyy(toD), days: preset.days }
  }, [range])

  // "All" omits from/to so /api/stats returns the all-time aggregate.
  const stats = useSWR<StatsResponse>(
    range === 'all' ? '/api/stats' : `/api/stats?from=${from}&to=${to}`,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true },
  )
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

  /* ── tokens + cost per project (RANGE-SCOPED, from /api/stats computed) ───── */
  const projectTotals: ProjectStat[] = React.useMemo(
    () => (c?.projectBreakdown ?? []).filter((p) => p.tokens > 0),
    [c],
  )

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

  const scopeLabel = range === 'all' ? 'all time' : `${monthLabel(from)}–${monthLabel(to)}`
  const dek =
    kpi && !loading
      ? `${fmtInt(kpi.sessions)} sessions · ${fmtInt(kpi.tokens)} tokens · ${scopeLabel}`
      : range === 'all'
        ? 'loading instruments · all time'
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

        {/* ── lead KPI readout — folded into one slim band (label·value·sub) ─── */}
        <KpiStrip
          loading={loading}
          items={
            kpi
              ? [
                  { label: 'Sessions', value: fmtInt(kpi.sessions), sub: `${fmtInt(kpi.activeDays)} active days` },
                  { label: 'Messages', value: fmtInt(kpi.messages), sub: `${fmtInt(kpi.toolCalls)} tool calls` },
                  { label: 'Tokens (i/o)', value: fmtTokens(kpi.tokens), tone: 'token', sub: 'input + output' },
                  {
                    label: 'Est. cost',
                    value: fmtCost(kpi.cost),
                    tone: 'cost',
                    sub: range === 'all' ? 'all time' : `over ${days}d`,
                  },
                  {
                    label: 'Cache saved',
                    value: fmtCost(kpi.cacheSaved),
                    sub: `${Math.round(kpi.cacheHit * 100)}% hit`,
                  },
                  { label: 'Tokens / day', value: fmtTokens(kpi.tokensPerDay), sub: 'active-day avg' },
                  {
                    label: 'Tools / session',
                    value: kpi.toolsPerSession.toFixed(1),
                    tone: 'accent',
                    sub: `${fmtInt(kpi.toolCalls)} calls`,
                  },
                ]
              : []
          }
        />

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

        {/* ── peak hours + by-project + rhythm — dense 3-up filling the width ── */}
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
            eyebrow="BY PROJECT"
            title="Tokens & cost"
            headerRight={<MonoNote>{scopeLabel} · top 7</MonoNote>}
          >
            {loading ? <ChartSkeleton height={156} /> : <ProjectBreakdown data={projectTotals} />}
          </Panel>

          <Panel eyebrow="RHYTHM" title="Day of week" headerRight={<MonoNote>sessions / weekday</MonoNote>}>
            {activity.isLoading && !activity.data ? <ChartSkeleton height={140} /> : <DayOfWeek data={dow} height={140} />}
          </Panel>
        </div>

        {/* ── activity heatmap (bigger, fills) + tool load to its right ──────── */}
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'minmax(0, 2.1fr) minmax(280px, 1fr)' }}
        >
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
            {activity.isLoading && !activity.data ? <ChartSkeleton height={160} /> : <ActivityHeatmap data={heat} />}
          </Panel>

          <Panel
            eyebrow="TOOL LOAD"
            title="What Claude runs"
            headerRight={<MonoNote>all-time</MonoNote>}
          >
            {projects.isLoading && !projects.data ? (
              <ChartSkeleton height={160} />
            ) : toolLoad.length ? (
              <ToolLoad data={toolLoad} />
            ) : (
              <FallbackNote>
                tool breakdown unavailable · {fmtInt(kpi?.toolCalls ?? 0)} calls
              </FallbackNote>
            )}
          </Panel>
        </div>
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

/* ── KPI strip — the headline readout folded into one slim horizontal band.
   Each metric is a label·value·sub cell separated by hairline dividers, so the
   seven KPIs occupy ~one line instead of a tall tile grid. ─────────────────── */
type KpiTone = 'default' | 'token' | 'cost' | 'accent'
const KPI_TONE: Record<KpiTone, string> = {
  default: 'var(--v2-text)',
  token: 'var(--v2-token)',
  cost: 'var(--v2-cost)',
  accent: 'var(--v2-accent)',
}
interface KpiItem {
  label: string
  value: string
  sub?: string
  tone?: KpiTone
}

function KpiStrip({ items, loading }: { items: KpiItem[]; loading: boolean }) {
  const cell = (i: number): React.CSSProperties => ({
    flex: '1 1 0',
    minWidth: 124,
    padding: '11px 18px',
    borderLeft: i ? '1px solid var(--v2-border)' : undefined,
  })
  return (
    <div
      className="flex flex-wrap items-stretch"
      style={{
        background: 'var(--v2-surface)',
        border: '1px solid var(--v2-border)',
        borderRadius: 'var(--v2-radius)',
        overflow: 'hidden',
      }}
    >
      {loading || !items.length
        ? Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex flex-col justify-center gap-1.5" style={cell(i)}>
              <SkeletonRow height={9} width="55%" />
              <SkeletonRow height={18} width="72%" />
            </div>
          ))
        : items.map((it, i) => (
            <div key={it.label} className="flex flex-col justify-center" style={cell(i)}>
              <span
                className="uppercase"
                style={{
                  fontFamily: 'var(--v2-font-sans)',
                  fontSize: 'var(--v2-text-label)',
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  lineHeight: 1.2,
                  color: 'var(--v2-faint)',
                }}
              >
                {it.label}
              </span>
              <span
                style={{
                  fontFamily: 'var(--v2-font-mono)',
                  fontSize: 'var(--v2-text-hero)',
                  fontWeight: 600,
                  lineHeight: 1.1,
                  fontVariantNumeric: 'tabular-nums',
                  color: KPI_TONE[it.tone ?? 'default'],
                  marginTop: 2,
                }}
              >
                {it.value}
              </span>
              {it.sub && (
                <span
                  style={{
                    fontFamily: 'var(--v2-font-mono)',
                    fontSize: 'var(--v2-text-micro)',
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--v2-muted)',
                    marginTop: 2,
                  }}
                >
                  {it.sub}
                </span>
              )}
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
