/* ═══════════════════════════════════════════════════════════════════════════
   SESSION DATA — normalization for the FLIGHTDECK Sessions screen.

   Turns the raw /api/sessions `SessionWithFacet` records into a lean, display-
   ready `SessionRowData`: derives a human project NAME from the long path, an
   inferred topic title (facet summary → first_prompt → fallback), an idle-capped
   ACTIVE-time estimate (avoids inflated wall-clock duration), and a recency
   StatusDot state. Pure — no React, safe to unit-test.
   ═══════════════════════════════════════════════════════════════════════════ */

import type { SessionWithFacet } from '@/types/claude'
import { activeMinutes } from '@/lib/active-time'
import { sessionTitle } from '@/lib/session-title'
import type { StatusDotState } from '@/components/v2/ui'

export interface SessionRowData {
  id: string
  projectName: string
  projectPath: string
  /** Human session NAME — the prominent label (slug → first_prompt → id). */
  title: string
  /** Inferred topic line (facet summary → first_prompt), shown as secondary context. */
  topic: string
  /** Raw first_prompt, kept for full-text search. */
  firstPrompt: string
  lastActivity: string | undefined
  startTime: string | undefined
  /** ms epoch of lastActivity (or start) for sorting. */
  sortTime: number
  recency: StatusDotState
  cost: number
  tokens: number
  activeMinutes: number
  model: string | undefined
  /** Coarse model family, for one-tap filtering. */
  modelFamily: ModelFamily
  branch: string | undefined
  usesMcp: boolean
  usesTaskAgent: boolean
  hasCompaction: boolean
  hasThinking: boolean
  toolErrors: number
  slug: string | undefined
  /** Lowercased haystack for fast client-side filtering. */
  haystack: string
}

/** Derive a short, human project name from a filesystem path. */
export function projectNameFromPath(path: string): string {
  if (!path) return 'unknown'
  const clean = path.replace(/\/+$/, '')
  const parts = clean.split('/').filter(Boolean)
  if (parts.length === 0) return clean || 'unknown'
  const last = parts[parts.length - 1]
  // Home directory itself → label it as such rather than the username.
  if (/^\/Users\/[^/]+$/.test(clean) || /^\/home\/[^/]+$/.test(clean)) return '~ (home)'
  return last
}

/** Collapse a first_prompt into a single tidy topic line. */
export function inferTitle(s: SessionWithFacet): string {
  const summary = s.facet?.brief_summary?.trim()
  if (summary) return summary
  const goal = s.facet?.underlying_goal?.trim()
  if (goal) return goal
  const fp = (s.first_prompt ?? '').replace(/\s+/g, ' ').trim()
  if (!fp) return 'Untitled session'
  // Trim a leading bare path that often opens a prompt ("In the repo /Users/..").
  const firstSentence = fp.split(/(?<=[.?!])\s/)[0] ?? fp
  const candidate = firstSentence.length > 12 ? firstSentence : fp
  return candidate.length > 140 ? candidate.slice(0, 140).trimEnd() + '…' : candidate
}

/** Recency → StatusDot state: live<6m → live, <24h → recent, else idle. */
function recencyOf(lastActivity: string | undefined): StatusDotState {
  if (!lastActivity) return 'idle'
  const t = Date.parse(lastActivity)
  if (Number.isNaN(t)) return 'idle'
  const ageMin = (Date.now() - t) / 60000
  if (ageMin < 6) return 'live'
  if (ageMin < 60 * 24) return 'recent'
  return 'idle'
}

export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'other'
const MODEL_FAMILIES: ModelFamily[] = ['opus', 'sonnet', 'haiku', 'fable']

/** Coarse model family from a model id, for filtering (mirrors shortModel's logic). */
export function modelFamilyOf(model: string | undefined): ModelFamily {
  if (!model) return 'other'
  const m = model.toLowerCase()
  return MODEL_FAMILIES.find((f) => m.includes(f)) ?? 'other'
}

/** Pick the dominant model by token volume from model_usage, else undefined. */
function dominantModel(s: SessionWithFacet): string | undefined {
  const usage = s.model_usage
  if (!usage) return undefined
  let best: string | undefined
  let bestTok = -1
  for (const [model, u] of Object.entries(usage)) {
    const tok = (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0)
    if (tok > bestTok) {
      bestTok = tok
      best = model
    }
  }
  return best
}

export function toRowData(s: SessionWithFacet): SessionRowData {
  const projectName = projectNameFromPath(s.project_path)
  // Lead with a human session NAME (slug → first_prompt → id). The inferred
  // topic line is kept separately as secondary context + for full-text search.
  const title = sessionTitle({
    custom_title: s.custom_title,
    slug_name: s.slug,
    first_prompt: s.first_prompt,
    session_id: s.session_id,
  })
  const topic = inferTitle(s)
  const lastActivity = s.last_activity ?? s.start_time
  const sortTime = Date.parse(lastActivity ?? '') || Date.parse(s.start_time ?? '') || 0
  const tokens = (s.input_tokens ?? 0) + (s.output_tokens ?? 0)

  // Prefer the idle-capped active estimate from real message timestamps; fall
  // back to the (less honest) wall-clock duration only when timestamps absent.
  const stamps = s.user_message_timestamps ?? []
  const active = stamps.length > 0 ? activeMinutes(stamps) : (s.duration_minutes ?? 0)

  const firstPrompt = (s.first_prompt ?? '').replace(/\s+/g, ' ').trim()
  const branch = s.git_branch?.trim() || undefined

  return {
    id: s.session_id,
    projectName,
    projectPath: s.project_path,
    title,
    topic,
    firstPrompt,
    lastActivity,
    startTime: s.start_time,
    sortTime,
    recency: recencyOf(lastActivity),
    cost: s.estimated_cost ?? 0,
    tokens,
    activeMinutes: active,
    model: dominantModel(s),
    modelFamily: modelFamilyOf(dominantModel(s)),
    branch,
    usesMcp: !!s.uses_mcp,
    usesTaskAgent: !!s.uses_task_agent,
    hasCompaction: !!s.has_compaction,
    hasThinking: !!s.has_thinking,
    toolErrors: s.tool_errors ?? 0,
    slug: s.slug,
    haystack: [projectName, title, topic, firstPrompt, s.slug ?? '', branch ?? '', s.model_usage ? Object.keys(s.model_usage).join(' ') : '']
      .join(' ')
      .toLowerCase(),
  }
}

export type SortKey = 'recent' | 'cost' | 'tokens' | 'active' | 'errors' | 'oldest'

export const SORT_LABELS: Record<SortKey, string> = {
  recent: 'newest',
  cost: 'cost',
  tokens: 'tokens',
  active: 'active time',
  errors: 'errors',
  oldest: 'oldest',
}

export function sortRows(rows: SessionRowData[], key: SortKey): SessionRowData[] {
  const copy = rows.slice()
  switch (key) {
    case 'cost':
      copy.sort((a, b) => b.cost - a.cost)
      break
    case 'tokens':
      copy.sort((a, b) => b.tokens - a.tokens)
      break
    case 'active':
      copy.sort((a, b) => b.activeMinutes - a.activeMinutes)
      break
    case 'errors':
      copy.sort((a, b) => b.toolErrors - a.toolErrors)
      break
    case 'oldest':
      copy.sort((a, b) => a.sortTime - b.sortTime)
      break
    case 'recent':
    default:
      copy.sort((a, b) => b.sortTime - a.sortTime)
  }
  return copy
}
