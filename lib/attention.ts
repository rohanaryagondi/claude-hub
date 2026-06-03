/* ═══════════════════════════════════════════════════════════════════════════
   lib/attention.ts — the NEEDS-ATTENTION derivation (pure, isomorphic, zero-LLM).

   The Command Deck's right rail is a ranked list of things that want the owner's
   eyes. Every signal here is derived from data the home already polls — the live
   feed (/api/sessions/active, ~2s) and the project summaries (/api/projects, ~30s)
   — so attention costs no extra fetch and never spawns a `claude` subprocess.

   Two pure entry points + a ranker:
     liveAttention(active, now)             → awaiting-input / idle-live / just-finished / cost-spike
     projectAttention(projects, live, now)  → dormant-project / stale-memory
     rankAttention(items)                   → dedupe, sort by severity, cap

   "Awaiting input" is inferred WITHOUT an AI call: deriveNow(recent_turns) reports
   whether Claude's latest turn issued tool calls (acting) or is a plain reply
   (done → waiting on you). That heuristic is the whole trick.
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  type ActiveResponse,
  type ActiveSessionFull,
  deriveNow,
  ageMs,
  fmtAge,
  fmtTokens,
  fmtCost,
  folderName,
  cleanText,
  LIVE_WINDOW_MS,
} from '@/components/v2/live/live-types'
import type { ProjectSummary } from '@/types/claude'

export type AttentionKind =
  | 'awaiting-input'
  | 'idle-live'
  | 'just-finished'
  | 'cost-spike'
  | 'dormant-project'
  | 'stale-memory'

/** Semantic tone → drives the row's dot/colour (matches the FLIGHTDECK palette). */
export type AttentionTone = 'recent' | 'cost' | 'live' | 'idle'

export interface AttentionItem {
  /** Stable key for dedupe + React lists. */
  id: string
  kind: AttentionKind
  /** Human subject — a project/session name, never a hex id. */
  title: string
  /** One line: why this is here. */
  detail: string
  tone: AttentionTone
  /** Where clicking goes. */
  href: string
  /** Project path, for the per-project hue spine. */
  projectPath?: string
  /** Higher = more urgent (ranking). */
  severity: number
  /** Age in ms of the underlying event (for the trailing timestamp + tie-break). */
  ageMs?: number
}

// ── Thresholds (tuned to be quiet — attention should mean something) ──────────
const DAY_MS = 24 * 60 * 60 * 1000
const IDLE_LIVE_MS = 6 * 60 * 1000 // "live" by window but untouched this long → stalled
const AWAIT_SETTLE_MS = 15 * 1000 // don't flag awaiting until the reply has settled
const JUST_FINISHED_MS = 60 * 60 * 1000 // a finished session stays "just finished" for an hour
const COST_SPIKE_USD = 15 // a single session this expensive is worth a glance
const DORMANT_MIN_DAYS = 7 // untouched at least this long
const DORMANT_MAX_DAYS = 45 // …but stop nagging about truly abandoned ones
const DORMANT_MIN_ACTIVITY = 3 // …and only if it was meaningfully busy in the last 14d
const STALE_ACTIVE_DAYS = 3 // a project touched this recently should have a recap

function truncate(s: string, n: number): string {
  const t = (s ?? '').trim()
  return t.length > n ? t.slice(0, n).trimEnd() + '…' : t
}

/** A readable subject for a session row — the project folder, never a hex id. */
function sessionTitle(s: ActiveSessionFull): string {
  return folderName(s.project_path)
}

/**
 * Live-feed attention: awaiting-input, idle-live, just-finished, cost-spike.
 * Pure over the /api/sessions/active payload + a clock.
 */
export function liveAttention(active: ActiveResponse | undefined, now: number): AttentionItem[] {
  const items: AttentionItem[] = []
  // Collapse just-finished to one row per project (most recent) — several
  // finished sessions from the same project is noise, not signal.
  const justFinished = new Map<string, AttentionItem>()
  for (const s of active?.sessions ?? []) {
    const age = ageMs(s.file_mtime_ms, now)
    const live = age <= LIVE_WINDOW_MS
    const doing = deriveNow(s.recent_turns ?? [])
    const title = sessionTitle(s)
    const tokens = (s.input_tokens ?? 0) + (s.output_tokens ?? 0)

    if (live) {
      if (!doing.acting && age >= AWAIT_SETTLE_MS) {
        // Claude posted a reply and isn't running tools → it's waiting on the owner.
        items.push({
          id: `await:${s.session_id}`,
          kind: 'awaiting-input',
          title,
          detail: truncate(cleanText(doing.detail) || 'waiting for your reply', 96),
          tone: 'recent',
          href: `/sessions/${s.session_id}`,
          projectPath: s.project_path,
          // Tier 300; longer waits rank higher within the tier (capped).
          severity: 300 + Math.min(40, age / 60000),
          ageMs: age,
        })
      } else if (doing.acting && age >= IDLE_LIVE_MS) {
        // Live by window, but no file activity for minutes while mid-tool →
        // stalled. Top tier (400): a stuck run wants eyes before anything else.
        items.push({
          id: `idle:${s.session_id}`,
          kind: 'idle-live',
          title,
          detail: `running ${doing.verb} — no activity ${fmtAge(age)}`,
          tone: 'recent',
          href: `/sessions/${s.session_id}`,
          projectPath: s.project_path,
          severity: 400 + Math.min(40, age / 60000),
          ageMs: age,
        })
      }
      // else: acting + fresh → working fine, not an attention item.
    } else if (age <= JUST_FINISHED_MS) {
      const cand: AttentionItem = {
        id: `done:${s.session_id}`,
        kind: 'just-finished',
        title,
        detail: `finished ${fmtAge(age)} ago · ${fmtTokens(tokens)} tok`,
        tone: 'idle',
        href: `/sessions/${s.session_id}`,
        projectPath: s.project_path,
        severity: 100 - age / JUST_FINISHED_MS, // tier 100; newer ranks higher
        ageMs: age,
      }
      const prev = justFinished.get(s.project_path)
      if (!prev || (cand.ageMs ?? Infinity) < (prev.ageMs ?? Infinity)) {
        justFinished.set(s.project_path, cand)
      }
    }

    // Cost spike only matters while a session is still LIVE (still burning) —
    // a finished expensive session is history, not something needing attention.
    if (live && (s.estimated_cost ?? 0) >= COST_SPIKE_USD) {
      items.push({
        id: `cost:${s.session_id}`,
        kind: 'cost-spike',
        title,
        detail: `${fmtCost(s.estimated_cost)} this session`,
        tone: 'cost',
        href: `/sessions/${s.session_id}`,
        projectPath: s.project_path,
        // Tier 200 (below awaiting/stalled); bigger spend ranks higher, bounded.
        severity: 200 + Math.min(90, s.estimated_cost),
        ageMs: age,
      })
    }
  }
  for (const it of justFinished.values()) items.push(it)
  return items
}

/**
 * Project/memory attention: dormant-project, stale-memory.
 * Pure over the /api/projects payload + the set of project paths currently live.
 */
export function projectAttention(
  projects: ProjectSummary[] | undefined,
  liveProjectPaths: Set<string>,
  now: number,
): AttentionItem[] {
  const items: AttentionItem[] = []
  for (const p of projects ?? []) {
    const lastMs = Date.parse(p.last_active ?? '')
    if (!Number.isFinite(lastMs)) continue
    const age = now - lastMs
    const days = age / DAY_MS
    const recentBusy = (p.activity ?? []).reduce((a, b) => a + b, 0) >= DORMANT_MIN_ACTIVITY

    if (
      days >= DORMANT_MIN_DAYS &&
      days <= DORMANT_MAX_DAYS &&
      recentBusy &&
      !liveProjectPaths.has(p.project_path)
    ) {
      items.push({
        id: `dormant:${p.slug}`,
        kind: 'dormant-project',
        title: p.display_name,
        detail: p.status?.trim()
          ? truncate(p.status, 90)
          : `untouched ${Math.round(days)}d — left mid-flight?`,
        tone: 'idle',
        href: `/projects/${p.slug}`,
        projectPath: p.project_path,
        severity: 50 + Math.min(10, days / 7),
        ageMs: age,
      })
    }

    // Recently active but the memory layer has no recap/status for it yet.
    if (days <= STALE_ACTIVE_DAYS && !p.recap?.trim() && !p.status?.trim()) {
      items.push({
        id: `recap:${p.slug}`,
        kind: 'stale-memory',
        title: p.display_name,
        detail: 'no recap yet — rebuild memory on Desk',
        tone: 'idle',
        href: '/desk',
        projectPath: p.project_path,
        severity: 25,
        ageMs: age,
      })
    }
  }
  return items
}

/** Dedupe by id and sort by severity (then recency). Returns the full list;
    capping is left to the view so dismissals can reveal the next item. */
export function rankAttention(items: AttentionItem[]): AttentionItem[] {
  const seen = new Set<string>()
  const deduped: AttentionItem[] = []
  for (const it of items) {
    if (seen.has(it.id)) continue
    seen.add(it.id)
    deduped.push(it)
  }
  deduped.sort((a, b) => b.severity - a.severity || (a.ageMs ?? 0) - (b.ageMs ?? 0))
  return deduped
}

/** Convenience: the full ranked digest (uncapped) from both feeds. */
export function buildAttention(
  active: ActiveResponse | undefined,
  projects: ProjectSummary[] | undefined,
  now: number,
): { items: AttentionItem[] } {
  const liveProjectPaths = new Set(
    (active?.sessions ?? [])
      .filter((s) => ageMs(s.file_mtime_ms, now) <= LIVE_WINDOW_MS)
      .map((s) => s.project_path),
  )
  const all = [
    ...liveAttention(active, now),
    ...projectAttention(projects, liveProjectPaths, now),
  ]
  return { items: rankAttention(all) }
}
