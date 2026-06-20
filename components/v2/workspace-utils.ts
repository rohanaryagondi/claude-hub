'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   Project Workspace — shared helpers (FLIGHTDECK §6, Project Workspace).
   Pure utilities used by the workspace sub-panels. No JSX, client-safe.
   ──────────────────────────────────────────────────────────────────────────── */

import type { SessionWithFacet, ProjectSummary } from '@/types/claude'
import { sessionTitle } from '@/lib/session-title'

/** A SessionMeta as actually returned by /api/sessions (slug/facet may be absent). */
export type ProjectSession = SessionWithFacet

/**
 * The human session NAME for display (slug → first_prompt → id). Maps the
 * API's `slug` field onto the title helper's `slug_name`. Owner feedback:
 * lead with the session name, not the folder or a raw hex id.
 */
export function sessionTitleOf(s: ProjectSession): string {
  return sessionTitle({
    custom_title: s.custom_title,
    slug_name: s.slug,
    first_prompt: s.first_prompt,
    session_id: s.session_id,
  })
}

/** Filter the full session list to one project by its absolute project_path. */
export function sessionsForProject(
  all: ProjectSession[] | undefined,
  projectPath: string | undefined,
): ProjectSession[] {
  if (!all || !projectPath) return []
  return all
    .filter((s) => s.project_path === projectPath)
    .sort((a, b) => msOf(b.last_activity ?? b.start_time) - msOf(a.last_activity ?? a.start_time))
}

export function msOf(iso: string | undefined): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

/** Total active coding minutes across a set of sessions (from message timestamps). */
export function totalActiveMinutes(sessions: ProjectSession[], activeMins: (ts: string[]) => number): number {
  let sum = 0
  for (const s of sessions) sum += activeMins(s.user_message_timestamps ?? [])
  return sum
}

/** Sum a numeric field across sessions. */
export function sumField(sessions: ProjectSession[], pick: (s: ProjectSession) => number): number {
  let sum = 0
  for (const s of sessions) sum += pick(s) || 0
  return sum
}

const DAY_MS = 86_400_000

/** A YYYY-MM-DD key in local time. */
export function dayKey(iso: string | undefined): string {
  const t = msOf(iso)
  if (!t) return 'unknown'
  const d = new Date(t)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Human label for a day group ("Today", "Yesterday", or a short date). */
export function dayLabel(key: string): string {
  if (key === 'unknown') return 'Unknown date'
  const parts = key.split('-').map(Number)
  const d = new Date(parts[0], parts[1] - 1, parts[2])
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - d.getTime()) / DAY_MS)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff > 1 && diff < 7) return `${diff} days ago`
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export interface DayGroup {
  key: string
  label: string
  sessions: ProjectSession[]
}

/** Group sessions (already recency-sorted) into day buckets, newest day first. */
export function groupByDay(sessions: ProjectSession[]): DayGroup[] {
  const map = new Map<string, ProjectSession[]>()
  for (const s of sessions) {
    const k = dayKey(s.last_activity ?? s.start_time)
    const arr = map.get(k)
    if (arr) arr.push(s)
    else map.set(k, [s])
  }
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([key, ss]) => ({ key, label: dayLabel(key), sessions: ss }))
}

/**
 * A per-day cost + active-minutes series for the last `days` days (oldest→newest),
 * derived from this project's sessions. Drives the Overview chart.
 */
export interface DayPoint {
  key: string
  label: string
  cost: number
  tokens: number
  sessions: number
}

export function dailySeries(
  sessions: ProjectSession[],
  days = 30,
): DayPoint[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const points: DayPoint[] = []
  const index = new Map<string, DayPoint>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const p: DayPoint = {
      key,
      label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      cost: 0,
      tokens: 0,
      sessions: 0,
    }
    points.push(p)
    index.set(key, p)
  }
  for (const s of sessions) {
    const k = dayKey(s.last_activity ?? s.start_time)
    const p = index.get(k)
    if (!p) continue
    p.cost += s.estimated_cost || 0
    p.tokens += (s.input_tokens || 0) + (s.output_tokens || 0)
    p.sessions += 1
  }
  return points
}

/** Top N tools by call count across the project's tool_counts map. */
export function topTools(toolCounts: Record<string, number> | undefined, n = 6): Array<{ name: string; count: number }> {
  if (!toolCounts) return []
  return Object.entries(toolCounts)
    .map(([name, count]) => ({ name: prettyToolName(name), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
}

/** Collapse long MCP tool identifiers to something readable. */
export function prettyToolName(name: string): string {
  if (name.startsWith('mcp__')) {
    const parts = name.split('__')
    return `mcp·${parts[parts.length - 1] ?? name}`
  }
  return name
}

/** A short, single-line excerpt of a first_prompt for resume/recall scanning. */
export function promptExcerpt(prompt: string | undefined, max = 140): string {
  if (!prompt) return ''
  const clean = prompt.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return clean.slice(0, max).replace(/\s\S*$/, '') + '…'
}
