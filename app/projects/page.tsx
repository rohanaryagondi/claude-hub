'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   PROJECTS — FLIGHTDECK canopy (spec §6).

   A scannable index of every project as a grid of ProjectCards. Each card is
   the implicit "resume" — clicking links to /projects/<slug>. Per the
   owner's preferences each card shows only: folder name, last_prompt, status,
   ACTIVE coding time, cost + tokens, and the 14-day activity sparkline.

   This screen adds:
     • a summary strip (projects · sessions · tokens · cost · active)
     • a search box filtering on name + last_prompt
     • recency grouping (Active now / Today / This week / This month / Earlier)
       built on the spec's <Section> header primitive.

   Data: GET /api/projects (SWR) + useLive() for live-session detection.
   ═══════════════════════════════════════════════════════════════════════════ */

import '@/components/v2/ui/v2-tokens.css' // shimmer/pulse keyframes for primitives

import * as React from 'react'
import useSWR from 'swr'
import { Search } from 'lucide-react'
import { V2Shell } from '@/components/v2/shell'
import {
  Section,
  SearchInput,
  StatTile,
  SkeletonRow,
  StatusDot,
  StretchGrid,
} from '@/components/v2/ui'
import { ProjectCard, type ProjectCardSize } from '@/components/v2/project-card'
import { SortControl } from '@/components/v2/sort-control'
import { useLive } from '@/components/layout/live-context'
import { formatActive } from '@/lib/active-time'
import type { ProjectSummary } from '@/types/claude'

/* ── Sort pivots: recency buckets by default; the others collapse into a single
   ranked grid so you can triage by spend / effort / volume / staleness. ────── */
type SortKey = 'recent' | 'cost' | 'active' | 'volume' | 'stale'
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'recent' },
  { key: 'cost', label: 'cost' },
  { key: 'active', label: 'active' },
  { key: 'volume', label: 'tokens' },
  { key: 'stale', label: 'stale' },
]
const SORT_DEK: Record<Exclude<SortKey, 'recent'>, string> = {
  cost: 'most expensive first',
  active: 'most active coding time first',
  volume: 'most tokens first',
  stale: 'oldest activity first — forgotten but unfinished',
}
const projTokens = (p: ProjectSummary) => (p.input_tokens ?? 0) + (p.output_tokens ?? 0)
const projLastMs = (p: ProjectSummary) => Date.parse(p.last_active || '') || 0
function sortProjects(list: ProjectSummary[], key: SortKey): ProjectSummary[] {
  const arr = [...list]
  switch (key) {
    case 'cost': return arr.sort((a, b) => (b.estimated_cost ?? 0) - (a.estimated_cost ?? 0))
    case 'active': return arr.sort((a, b) => (b.active_minutes ?? 0) - (a.active_minutes ?? 0))
    case 'volume': return arr.sort((a, b) => projTokens(b) - projTokens(a))
    case 'stale': return arr.sort((a, b) => projLastMs(a) - projLastMs(b)) // oldest first
    default: return arr.sort((a, b) => projLastMs(b) - projLastMs(a))
  }
}

const fetcher = (u: string) => fetch(u).then((r) => r.json())

type ProjectsResponse = { projects: ProjectSummary[] }

const LIVE_MS = 10 * 60 * 1000

/* ── Recency buckets (spec §6) ────────────────────────────────────────────── */

type BucketId = 'now' | 'today' | 'week' | 'month' | 'earlier'

const BUCKETS: { id: BucketId; title: string; eyebrow: string }[] = [
  { id: 'now', title: 'Active now', eyebrow: 'LIVE' },
  { id: 'today', title: 'Today', eyebrow: 'RECENT' },
  { id: 'week', title: 'This week', eyebrow: 'WEEK' },
  { id: 'month', title: 'This month', eyebrow: 'MONTH' },
  { id: 'earlier', title: 'Earlier', eyebrow: 'ARCHIVE' },
]

/* Card size grades by recency: current work gets room, the archive gets density
   (owner: big cards for live/recent, small for older so they all fit at once). */
const SIZE_BY_BUCKET: Record<BucketId, ProjectCardSize> = {
  now: 'briefing',
  today: 'briefing',
  week: 'briefing',
  month: 'medium',
  earlier: 'compact',
}

/** Min column width per size — drives how many cards fit per row. (`briefing`
    uses an explicit ≤4-wide, expand-when-fewer grid instead; see gridColumns.) */
const GRID_MIN_PX: Record<ProjectCardSize, number> = {
  xl: 440,
  large: 340,
  briefing: 340,
  medium: 260,
  compact: 190,
}

/** A stretched grid of ProjectCards (no phantom columns; cards content-fit).
    Briefing caps at 4 wide and expands when fewer; others fill by min width. */
function CardGrid({
  items,
  size,
  now,
  livePaths,
  liveByPath,
}: {
  items: ProjectSummary[]
  size: ProjectCardSize
  now: number
  livePaths: Set<string>
  liveByPath: Map<string, { sessionId: string; mtimeMs: number }>
}) {
  return (
    <StretchGrid
      count={items.length}
      min={GRID_MIN_PX[size]}
      maxCols={size === 'briefing' ? 4 : undefined}
      gap={10}
      style={{ alignItems: 'start' }}
    >
      {items.map((p) => (
        <ProjectCard
          key={p.slug}
          project={p}
          now={now}
          isLive={livePaths.has(p.project_path)}
          size={size}
          liveSession={liveByPath.get(p.project_path)}
        />
      ))}
    </StretchGrid>
  )
}

function bucketOf(
  lastActive: string | undefined,
  now: number,
  isLive: boolean
): BucketId {
  if (isLive) return 'now'
  const t = lastActive ? Date.parse(lastActive) : NaN
  if (Number.isNaN(t)) return 'earlier'
  const age = now - t
  if (age <= LIVE_MS) return 'now'
  if (age <= 24 * 60 * 60 * 1000) return 'today'
  if (age <= 7 * 24 * 60 * 60 * 1000) return 'week'
  if (age <= 30 * 24 * 60 * 60 * 1000) return 'month'
  return 'earlier'
}

/* ── Number formatting ────────────────────────────────────────────────────── */

function fmtCost(n: number): string {
  const v = n ?? 0
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`
  return `$${v.toFixed(2)}`
}
function fmtTokens(n: number): string {
  const v = n ?? 0
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return `${Math.round(v)}`
}
function fmtInt(n: number): string {
  return (n ?? 0).toLocaleString('en-US')
}

export default function V2ProjectsPage() {
  const { data, isLoading, error } = useSWR<ProjectsResponse>('/api/projects', fetcher, {
    refreshInterval: 15000,
  })
  const { sessions: liveSessions } = useLive()
  const [query, setQuery] = React.useState('')
  const [sort, setSort] = React.useState<SortKey>('recent')
  const searchRef = React.useRef<HTMLInputElement>(null)

  // Seed the search from a ?q= deep-link on first mount (shareable searches).
  // Client-only (window) to sidestep the useSearchParams Suspense requirement.
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q')
    if (q) setQuery(q)
  }, [])

  // `/` focuses the filter from anywhere (consistent with the deck + sessions).
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Stable "now" — re-derived each SWR tick (data changes), which is frequent
  // enough for the relative ages here. Set in an effect (not during render) so
  // it stays pure.
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => { setNow(Date.now()) }, [data])

  // Which project paths currently have a live session (file touched ≤ 10 min),
  // and the most-recently-active live session per path (for the live now-line).
  const livePaths = React.useMemo(() => {
    const set = new Set<string>()
    for (const s of liveSessions ?? []) {
      if (now - s.file_mtime_ms <= LIVE_MS) set.add(s.project_path)
    }
    return set
  }, [liveSessions, now])

  const liveByPath = React.useMemo(() => {
    const map = new Map<string, { sessionId: string; mtimeMs: number }>()
    for (const s of liveSessions ?? []) {
      if (now - s.file_mtime_ms > LIVE_MS) continue
      const prev = map.get(s.project_path)
      if (!prev || s.file_mtime_ms > prev.mtimeMs) {
        map.set(s.project_path, { sessionId: s.session_id, mtimeMs: s.file_mtime_ms })
      }
    }
    return map
  }, [liveSessions, now])

  const projects = React.useMemo(() => data?.projects ?? [], [data])

  // Filter on folder name + last_prompt (case-insensitive).
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter((p) => {
      const name = p.display_name?.toLowerCase() ?? ''
      const prompt = p.last_prompt?.toLowerCase() ?? ''
      return name.includes(q) || prompt.includes(q)
    })
  }, [projects, query])

  // Summary strip totals (over the FILTERED set so the strip reflects the lens).
  const totals = React.useMemo(() => {
    let sessions = 0
    let tokens = 0
    let cost = 0
    let active = 0
    for (const p of filtered) {
      sessions += p.session_count ?? 0
      tokens += (p.input_tokens ?? 0) + (p.output_tokens ?? 0)
      cost += p.estimated_cost ?? 0
      active += p.active_minutes ?? 0
    }
    return { count: filtered.length, sessions, tokens, cost, active }
  }, [filtered])

  // Group into recency buckets; sort each bucket by last-active desc.
  const grouped = React.useMemo(() => {
    const map = new Map<BucketId, ProjectSummary[]>()
    for (const b of BUCKETS) map.set(b.id, [])
    for (const p of filtered) {
      const isLive = livePaths.has(p.project_path)
      map.get(bucketOf(p.last_active, now, isLive))!.push(p)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const ta = a.last_active ? Date.parse(a.last_active) : 0
        const tb = b.last_active ? Date.parse(b.last_active) : 0
        return tb - ta
      })
    }
    return map
  }, [filtered, livePaths, now])

  const liveProjectCount = grouped.get('now')?.length ?? 0
  const hasAny = filtered.length > 0

  return (
    <V2Shell active="projects">
      <div style={{ padding: 'var(--v2-s4) var(--v2-s5)', display: 'flex', flexDirection: 'column', gap: 'var(--v2-s4)' }}>
        {/* ── Canopy header ─────────────────────────────────────────────── */}
        <Section
          eyebrow="PROJECTS"
          title="All projects"
          dek={
            isLoading
              ? 'loading projects…'
              : `${projects.length} projects · ${liveProjectCount} live · sorted by recent activity`
          }
          actions={
            <div className="flex items-center gap-[var(--v2-s4)]">
              <SortControl options={SORT_OPTIONS} value={sort} onChange={setSort} ariaLabel="Sort projects" />
              <div style={{ width: 'min(280px, 36vw)' }}>
                <SearchInput
                  ref={searchRef}
                  value={query}
                  onValueChange={setQuery}
                  glyph={<Search size={13} />}
                  placeholder="filter name or last prompt"
                  readout={
                    query.trim()
                      ? `${filtered.length}/${projects.length}`
                      : undefined
                  }
                  aria-label="Filter projects"
                />
              </div>
            </div>
          }
        />

        {/* ── Summary strip ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-[var(--v2-s1)]">
        <span className="v2-label" style={{ color: 'var(--v2-faint)' }}>
          {query.trim()
            ? `TOTALS · matching “${query.trim()}” (all time)`
            : 'TOTALS · all time, all projects'}
        </span>
        <div
          className="grid gap-[var(--v2-s4)]"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            background: 'var(--v2-surface)',
            border: '1px solid var(--v2-border)',
            borderRadius: 'var(--v2-radius)',
            padding: 'var(--v2-s3) var(--v2-s4)',
          }}
        >
          <StatTile
            label="Projects"
            value={fmtInt(totals.count)}
            sub={query.trim() ? `of ${projects.length}` : 'tracked'}
          />
          <StatTile label="Sessions" value={fmtInt(totals.sessions)} />
          <StatTile label="Tokens" value={fmtTokens(totals.tokens)} tone="token" />
          <StatTile label="Cost" value={fmtCost(totals.cost)} tone="cost" />
          <StatTile
            label="Active"
            value={formatActive(totals.active)}
            sub="coding time"
            tone="default"
          />
        </div>
        </div>

        {/* ── Body: loading / error / empty / grouped grid ──────────────── */}
        {isLoading && !data ? (
          <LoadingState />
        ) : error ? (
          <EmptyState
            title="Couldn't load projects"
            body="The /api/projects endpoint did not respond. It will retry automatically."
          />
        ) : !hasAny ? (
          query.trim() ? (
            <EmptyState
              title="No matches"
              body={`Nothing matches "${query.trim()}". Try a shorter or different term.`}
            />
          ) : (
            <EmptyState
              title="No projects yet"
              body="Run Claude Code in a repo and your projects will appear here."
            />
          )
        ) : query.trim() ? (
          /* ── Search: surface every match as a big briefing card (ordered by the
                active sort), so retrieval always gives the rich view. ────────── */
          <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--v2-s3)' }}>
            <Section
              eyebrow="SEARCH"
              title={<span className="inline-flex items-center gap-[var(--v2-s2)]"><Search size={13} />Results</span>}
              dek={`${filtered.length} ${filtered.length === 1 ? 'match' : 'matches'} for “${query.trim()}”`}
            />
            <CardGrid
              items={sortProjects(filtered, sort)}
              size="briefing"
              now={now}
              livePaths={livePaths}
              liveByPath={liveByPath}
            />
          </section>
        ) : sort !== 'recent' ? (
          /* ── Ranked: recency buckets collapse into one grid sorted by the chosen
                pivot (cost / active / tokens / stale) for triage. ────────────── */
          <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--v2-s3)' }}>
            <Section
              eyebrow="SORTED"
              title={`By ${SORT_OPTIONS.find((o) => o.key === sort)?.label ?? sort}`}
              dek={SORT_DEK[sort as Exclude<SortKey, 'recent'>]}
            />
            <CardGrid
              items={sortProjects(filtered, sort)}
              size="medium"
              now={now}
              livePaths={livePaths}
              liveByPath={liveByPath}
            />
          </section>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--v2-s5)' }}>
            {BUCKETS.map((b) => {
              const items = grouped.get(b.id) ?? []
              if (items.length === 0) return null
              const size = SIZE_BY_BUCKET[b.id]
              return (
                <section key={b.id} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--v2-s3)' }}>
                  <Section
                    eyebrow={b.eyebrow}
                    title={
                      <span className="inline-flex items-center gap-[var(--v2-s2)]">
                        {b.id === 'now' && <StatusDot state="live" size={8} />}
                        {b.id === 'today' && <StatusDot state="recent" size={8} />}
                        {b.title}
                      </span>
                    }
                    dek={`${items.length} ${items.length === 1 ? 'project' : 'projects'}`}
                  />
                  <CardGrid
                    items={items}
                    size={size}
                    now={now}
                    livePaths={livePaths}
                    liveByPath={liveByPath}
                  />
                </section>
              )
            })}
          </div>
        )}
      </div>
    </V2Shell>
  )
}

/* ── Loading skeleton — calm shimmer rows, no spinner (spec §3) ───────────── */
function LoadingState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--v2-s4)' }}>
      <SkeletonRow height={14} width="22%" />
      <div
        className="grid gap-[var(--v2-s3)]"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonRow key={i} height={116} style={{ opacity: 1 - i * 0.08 }} />
        ))}
      </div>
    </div>
  )
}

/* ── Empty / error state ──────────────────────────────────────────────────── */
function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        border: '1px dashed var(--v2-border)',
        borderRadius: 'var(--v2-radius)',
        padding: 'var(--v2-s6)',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--v2-s2)',
        alignItems: 'center',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--v2-font-sans)',
          fontSize: 'var(--v2-text-sm-head)',
          fontWeight: 500,
          color: 'var(--v2-text)',
        }}
      >
        {title}
      </span>
      <span
        style={{
          fontFamily: 'var(--v2-font-sans)',
          fontSize: 'var(--v2-text-body)',
          color: 'var(--v2-muted)',
          maxWidth: 420,
        }}
      >
        {body}
      </span>
    </div>
  )
}
