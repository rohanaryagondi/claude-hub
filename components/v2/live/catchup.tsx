'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   CATCH UP — "SINCE YOUR LAST PROMPT" per-session summary (LIVE view).

   Owner feedback (#4): "produce a backend summary of what has happened SINCE my
   last prompt for a session — focus on the stuff the owner hasn't seen yet
   (what Claude DID while they were away), not an overall summary."

   Owner feedback (cards redesign): the catch-up summary is the PRIMARY content
   of a live tile — the tile exists so the owner can catch up across projects at
   a glance. So this module no longer renders an inset "CATCH UP" box; it
   exposes the DATA + small pieces and LiveTile composes them as the hero:
     • useCatchup(sessionId, mtimeMs)  — fetch + module cache (see contract)
     • deterministicSummary(data)      — non-AI fallback line / counts meta
     • AwaitingChip                    — the amber "waiting on you" signal

   The summary comes from GET /api/sessions/[id]/catchup-ai, which runs Claude
   Code's Haiku via the owner's subscription as a separate process and returns
   { summary, awaiting_user, since_count, tool_tally }.

   PERFORMANCE CONTRACT
   --------------------
   • The payload is cached at MODULE scope keyed by sessionId, stamped by the
     tile's `mtimeMs` (latest activity). The 1s/5s polls on the parent NEVER
     trigger a refetch — only a change in `mtimeMs` (new activity) or first
     appearance does.
   • Nothing here blocks the tile render: the fetch is an effect; callers show
     a deterministic line (or their own fallback) until data lands.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as React from 'react'
import { Clock } from 'lucide-react'

/* ── Shape of GET /api/sessions/[id]/catchup-ai ───────────────────────────── */
export interface CatchupAiData {
  /** Claude Haiku summary; '' when the CLI is unavailable. */
  summary: string
  awaiting_user: boolean
  since_count: number
  tool_tally: Record<string, number>
}

/* ── Per-session module cache. Survives remounts; the parent's polling cannot
     invalidate it. An entry is keyed by sessionId and STAMPED by mtimeMs (the
     tile's latest activity), so fresh activity supersedes a stale entry. ────── */
interface CacheEntry {
  /** mtimeMs this entry was built for. */
  stamp: number
  data: CatchupAiData
}
const CACHE = new Map<string, CacheEntry>()

/* ── Deterministic, non-AI fallback summary (always available) ────────────── */
function topToolPhrase(tally: Record<string, number>): string {
  // Map a few common tool names to human verbs; keep the rest as-is, lowercased.
  const VERB: Record<string, [string, string]> = {
    Edit: ['edit', 'edits'],
    MultiEdit: ['edit', 'edits'],
    Write: ['file write', 'file writes'],
    Read: ['read', 'reads'],
    Bash: ['bash', 'bash'],
    Grep: ['search', 'searches'],
    Glob: ['search', 'searches'],
    WebFetch: ['fetch', 'fetches'],
    WebSearch: ['web search', 'web searches'],
    AskUserQuestion: ['question', 'questions'],
  }
  const entries = Object.entries(tally)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  if (entries.length === 0) return ''
  return entries
    .map(([name, n]) => {
      const v = VERB[name]
      const label = v ? (n === 1 ? v[0] : v[1]) : name.toLowerCase()
      return `${n} ${label}`
    })
    .join(' · ')
}

export function deterministicSummary(d: CatchupAiData): string {
  if (d.since_count === 0) {
    return d.awaiting_user
      ? 'No new activity — waiting on you.'
      : 'No new activity since your last message.'
  }
  const tools = topToolPhrase(d.tool_tally)
  const evt = `${d.since_count} event${d.since_count === 1 ? '' : 's'} since your last message`
  const status = d.awaiting_user ? 'waiting on you' : 'still working'
  return [evt, tools, status].filter(Boolean).join(' · ')
}

/**
 * useCatchup — fetch the server-side catch-up lazily; refetch only when the
 * tile's mtime advances (new activity). Returns null until the first payload
 * lands (or when the endpoint failed and nothing is cached) — callers render
 * their own fallback in that case.
 */
export function useCatchup(sessionId: string, mtimeMs: number): CatchupAiData | null {
  const [data, setData] = React.useState<CatchupAiData | null>(
    () => CACHE.get(sessionId)?.data ?? null,
  )

  React.useEffect(() => {
    if (!sessionId) return // no live session for this caller — nothing to fetch
    const cached = CACHE.get(sessionId)
    if (cached && cached.stamp === mtimeMs) {
      // Already have this exact activity stamp — reuse, never refetch.
      setData(cached.data)
      return
    }

    let cancelled = false
    fetch(`/api/sessions/${sessionId}/catchup-ai`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: CatchupAiData) => {
        if (cancelled) return
        setData(d)
        CACHE.set(sessionId, { stamp: mtimeMs, data: d })
      })
      .catch(() => {
        /* keep any cached data; callers fall back when null */
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, mtimeMs])

  return data
}

/**
 * AwaitingChip — the most actionable signal on a tile: an amber "waiting on
 * you" pill when Claude has stopped for the owner, a faint "still working"
 * when it's mid-run, nothing otherwise.
 */
export function AwaitingChip({ data }: { data: CatchupAiData | null }) {
  if (!data) return null
  if (data.awaiting_user) {
    return (
      <span
        className="v2-mono inline-flex items-center gap-1 shrink-0"
        style={{
          fontSize: 'var(--v2-text-micro)',
          fontWeight: 600,
          color: 'var(--v2-recent)',
          background: 'color-mix(in srgb, var(--v2-recent) 14%, transparent)',
          border: '1px solid var(--v2-recent)',
          borderRadius: 999,
          padding: '0 6px',
          lineHeight: '15px',
        }}
        title="Claude has stopped and appears to be waiting for your reply"
      >
        <Clock size={9} />
        waiting on you
      </span>
    )
  }
  if (data.since_count > 0) {
    return (
      <span
        className="v2-mono shrink-0"
        style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-faint)' }}
        title="Claude is still working"
      >
        still working
      </span>
    )
  }
  return null
}
