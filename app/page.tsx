'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   HOME — the LIVE cockpit. FLIGHTDECK §6, the default landing screen.

   "What's happening right now" is the front door. A telemetry strip pins today's
   vital signs; a self-sorting "Live Shore" tile grid shows every running session
   as an instrument (what Claude is doing now, ticking tokens, a 60-cell activity
   strip); beneath, a `tail -f` watch feed streams cross-session events you can
   fly with j/k and open with Enter.

   Data: GET /api/sessions/active on a 5s SWR poll (the real endpoint). A 1s local
   clock interpolates ages + ticking token counters so the screen feels alive
   between polls without hammering the API.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { Radio } from 'lucide-react'
import { V2Shell } from '@/components/v2/shell'
import {
  Section,
  StatusDot,
  Pill,
  SkeletonRow,
  Kbd,
  StretchGrid,
} from '@/components/v2/ui'
import { LiveTile } from '@/components/v2/live/live-tile'
import { LiveSessionHero } from '@/components/v2/live/live-session-hero'
import {
  type ActiveResponse,
  type ActiveSessionFull,
  LIVE_WINDOW_MS,
  ageMs,
  fmtTokens,
  fmtCost,
  recentTokenRate,
} from '@/components/v2/live/live-types'
import type { ProjectSummary } from '@/types/claude'
import { buildAttention } from '@/lib/attention'
import { StandbyStrip } from '@/components/v2/home/standby-strip'
import { InlineRecall } from '@/components/v2/home/inline-recall'
import { ProjectPulse } from '@/components/v2/home/project-pulse'
import { AttentionQueue } from '@/components/v2/home/attention-queue'

const fetcher = (u: string) => fetch(u).then((r) => r.json())

export default function V2HomePage() {
  return (
    <V2Shell active="live">
      <LiveCockpit />
    </V2Shell>
  )
}

function LiveCockpit() {
  const router = useRouter()
  const { data, isLoading, error } = useSWR<ActiveResponse>(
    '/api/sessions/active',
    fetcher,
    {
      // Snappier while something is live (2s), relaxed when idle (5s). The 1s
      // ticking clock fills the gaps so the deck always reads alive.
      refreshInterval: (latest?: ActiveResponse) => {
        const anyLive = (latest?.sessions ?? []).some(
          (s) => Date.now() - s.file_mtime_ms <= LIVE_WINDOW_MS,
        )
        return anyLive ? 2000 : 5000
      },
      revalidateOnFocus: true,
    }
  )

  // ── Project summaries: feed the pulse roster + the durable attention signals
  //    (dormant project, missing recap). Slow poll (30s), decoupled from the 2s
  //    live feed — these change rarely and the read hits the SWR reader cache. ──
  const { data: projData } = useSWR<{ projects: ProjectSummary[] }>(
    '/api/projects',
    fetcher,
    { refreshInterval: 30000, revalidateOnFocus: false }
  )

  // ── Recall search box (`/` focuses it from anywhere on the deck). ──────────
  const searchRef = React.useRef<HTMLInputElement>(null)

  // ── 1s heartbeat clock: drives ages + ticking token interpolation between
  //    the 5s API polls, so the deck reads alive without extra requests. ──────
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const sessions = React.useMemo(() => data?.sessions ?? [], [data])
  const today = data?.today ?? { tokens: 0, cost: 0, session_count: 0 }
  const streak = data?.streak ?? 0

  // ── Partition + self-sort by recency (newest activity bubbles to top). ─────
  const sorted = React.useMemo(
    () => [...sessions].sort((a, b) => b.file_mtime_ms - a.file_mtime_ms),
    [sessions]
  )
  const liveSessions = sorted.filter((s) => ageMs(s.file_mtime_ms, now) <= LIVE_WINDOW_MS)
  const recentSessions = sorted.filter((s) => ageMs(s.file_mtime_ms, now) > LIVE_WINDOW_MS)
  const liveCount = liveSessions.length

  // ── Deck data: project roster + the ranked needs-attention digest (pure,
  //    zero-LLM — derived from the live feed + project summaries). ─────────────
  const projects = React.useMemo(() => projData?.projects ?? [], [projData])
  const liveProjectPaths = React.useMemo(
    () => new Set(liveSessions.map((s) => s.project_path)),
    [liveSessions]
  )
  const attention = React.useMemo(
    () => buildAttention(data, projects, now),
    [data, projects, now]
  )

  // ── Ticking token interpolator: when a session is live, nudge its token
  //    counter up gently between polls (capped) so the readout never sits dead.
  //    Reset to the true value whenever a fresh poll lands. ────────────────────
  const tickTokens = useTickingTokens(sorted, now, !!data)

  // ── Throughput: tokens/min over the last ~10 min across live sessions (a
  //    bounded RECENT window, not smeared across the day). ────────────────────
  const throughput = React.useMemo(() => {
    if (liveSessions.length === 0) return 0
    const allTurns = liveSessions.flatMap((s) => s.recent_turns ?? [])
    return recentTokenRate(allTurns, now)
  }, [liveSessions, now])

  // ── Keyboard cockpit: j/k walk LIVE sessions, Enter opens, o splits. ───────
  const [cursor, setCursor] = React.useState(0)
  React.useEffect(() => {
    if (cursor > liveSessions.length - 1) setCursor(Math.max(0, liveSessions.length - 1))
  }, [liveSessions.length, cursor])

  const openSession = React.useCallback(
    (id: string) => router.push(`/sessions/${id}`),
    [router]
  )
  const splitSession = React.useCallback(
    (id: string) => router.push(`/sessions/${id}?split=1`),
    [router]
  )

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'j') {
        e.preventDefault()
        setCursor((c) => Math.min(liveSessions.length - 1, c + 1))
      } else if (e.key === 'k') {
        e.preventDefault()
        setCursor((c) => Math.max(0, c - 1))
      } else if (e.key === 'Enter' && liveSessions[cursor]) {
        e.preventDefault()
        openSession(liveSessions[cursor].session_id)
      } else if (e.key === 'o' && liveSessions[cursor]) {
        e.preventDefault()
        splitSession(liveSessions[cursor].session_id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [liveSessions, cursor, openSession, splitSession])

  const totalLiveTokens = liveSessions.reduce(
    (a, s) => a + s.input_tokens + s.output_tokens,
    0
  )

  // ── Live spend in flight (shown in the slim strip). ────────────────────────
  const liveSpend = liveSessions.reduce((a, s) => a + s.estimated_cost, 0)

  return (
    <div className="v2-deck-root" style={{ padding: 'var(--v2-s4)', minHeight: '100%' }}>
      {/* ── Canopy header: eyebrow + title + scope dek ───────────────────── */}
      <div style={{ gridArea: 'header' }}>
        <Section
          eyebrow="DECK"
          title="Command deck"
          dek={
            isLoading
              ? 'connecting to flight data…'
              : `${liveCount} live · ${sessions.length} tracked · ${today.session_count} sessions today`
          }
          style={{ paddingBottom: 0 }}
          actions={
            <Pill variant={liveCount > 0 ? 'live' : 'neutral'} dot={liveCount > 0 ? 'live' : 'idle'}>
              {liveCount > 0 ? `${liveCount} active` : 'all quiet'}
            </Pill>
          }
        />
      </div>

      {/* ── Slim vital-signs strip ───────────────────────────────────────── */}
      <div
        className="flex items-center flex-wrap v2-mono"
        style={{
          gridArea: 'vitals',
          gap: 'var(--v2-s3)',
          padding: 'var(--v2-s2) var(--v2-s3)',
          background: 'var(--v2-surface-2)',
          border: '1px solid var(--v2-border)',
          borderRadius: 'var(--v2-radius)',
          fontSize: 'var(--v2-text-micro)',
        }}
      >
        <span className="inline-flex items-center gap-1.5" style={{ color: liveCount > 0 ? 'var(--v2-live)' : 'var(--v2-faint)' }}>
          <StatusDot state={liveCount > 0 ? 'live' : 'idle'} size={8} />
          <b style={{ fontWeight: 700 }}>{liveCount}</b> live
        </span>
        <Dot />
        <span style={{ color: 'var(--v2-token)' }}>{fmtTokens(totalLiveTokens)} in flight</span>
        <Dot />
        <span style={{ color: 'var(--v2-token)' }}>{fmtTokens(Math.round(throughput))}/m</span>
        <Dot />
        <span style={{ color: 'var(--v2-cost)' }}>{fmtCost(today.cost)} today</span>
        {liveSpend > 0 && <span style={{ color: 'var(--v2-cost)', opacity: 0.7 }}>({fmtCost(liveSpend)} live)</span>}
        <Dot />
        <span style={{ color: 'var(--v2-muted)' }}>{today.session_count} sessions</span>
        <Dot />
        <span style={{ color: 'var(--v2-recent)' }}>{streak}d streak</span>
        {error && (
          <span className="ml-auto" style={{ color: 'var(--v2-cost)' }}>flight data unavailable — retrying</span>
        )}
      </div>

      {/* ── LIVE band — adapts to live-count, always fills width: 1 → solo hero;
           2 → paired heroes; 3+ → stretched tile grid; 0 → slim standby. ───── */}
      <section className="flex flex-col gap-[var(--v2-s3)] min-h-0" style={{ gridArea: 'live' }}>
        {liveCount > 0 && <LiveHeader liveCount={liveCount} totalLiveTokens={totalLiveTokens} />}
        {isLoading && !data ? (
          <TileSkeletons />
        ) : liveCount === 0 ? (
          <StandbyStrip recentCount={recentSessions.length} />
        ) : liveCount === 1 ? (
          <LiveSessionHero
            session={liveSessions[0]}
            now={now}
            tickTokens={tickTokens[liveSessions[0].session_id]}
            variant="solo"
            onOpen={openSession}
            onSplit={splitSession}
          />
        ) : liveCount === 2 ? (
          <div className="grid gap-[var(--v2-s3)]" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            {liveSessions.map((s) => (
              <LiveSessionHero
                key={s.session_id}
                session={s}
                now={now}
                tickTokens={tickTokens[s.session_id]}
                variant="pair"
                onOpen={openSession}
                onSplit={splitSession}
              />
            ))}
          </div>
        ) : (
          <StretchGrid count={liveSessions.length} min={320} maxCols={4} gap={6} style={{ alignItems: 'start' }}>
            {liveSessions.map((s, i) => (
              <LiveTile
                key={s.session_id}
                session={s}
                now={now}
                tickTokens={tickTokens[s.session_id]}
                selected={i === cursor}
                onOpen={openSession}
                onSplit={splitSession}
              />
            ))}
          </StretchGrid>
        )}
      </section>

      {/* ── Lower deck — recall · projects · needs-attention. Always present, so
           the screen is useful whether 0 or 5 sessions are live. ───────────── */}
      <section className="v2-deck-grid" style={{ gridArea: 'deck' }}>
        <InlineRecall inputRef={searchRef} />
        {projects.length > 0 && (
          <ProjectPulse projects={projects} liveProjectPaths={liveProjectPaths} now={now} />
        )}
        <AttentionQueue items={attention.items} loading={!data && !projData} />
      </section>
    </div>
  )
}

/* ── Slim dot separator for the vital-signs strip ─────────────────────────── */
function Dot() {
  return <span aria-hidden style={{ color: 'var(--v2-faint)', opacity: 0.5 }}>·</span>
}

/* ── Live region header (radar + count) ───────────────────────────────────── */
function LiveHeader({ liveCount, totalLiveTokens }: { liveCount: number; totalLiveTokens: number }) {
  return (
    <div className="flex items-center gap-[var(--v2-s2)]">
      <Radio size={13} style={{ color: liveCount > 0 ? 'var(--v2-live)' : 'var(--v2-faint)' }} />
      <span className="v2-label">Live sessions</span>
      <span className="v2-mono" style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}>
        {liveCount > 0 ? `${liveCount} running · ${fmtTokens(totalLiveTokens)} tok` : 'idle — nothing running'}
      </span>
      {liveCount > 2 && (
        <span className="ml-auto inline-flex items-center gap-1.5">
          <Kbd>j</Kbd>
          <Kbd>k</Kbd>
          <span className="v2-mono" style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}>walk</span>
          <Kbd>↵</Kbd>
          <span className="v2-mono" style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}>open</span>
        </span>
      )}
    </div>
  )
}


/* ── Ticking token interpolator ─────────────────────────────────────────────
   For each live session, gently increment a local token estimate between polls
   based on its observed per-minute output rate (capped, so it never runs away).
   Resets to the authoritative value on every fresh API payload. */
function useTickingTokens(
  sessions: ActiveSessionFull[],
  now: number,
  hasData: boolean
): Record<string, number> {
  const baseRef = React.useRef<Record<string, { base: number; at: number; ratePerSec: number }>>({})
  const [, force] = React.useState(0)

  // On a fresh payload (sessions identity change), reset bases.
  React.useEffect(() => {
    if (!hasData) return
    const next: typeof baseRef.current = {}
    for (const s of sessions) {
      const total = s.input_tokens + s.output_tokens
      // Estimate a per-second rate from the most recent turn pair, capped low.
      const turns = s.recent_turns ?? []
      let ratePerSec = 0
      if (turns.length >= 2) {
        const a = turns[turns.length - 2]
        const b = turns[turns.length - 1]
        const dt = (Date.parse(b.timestamp) - Date.parse(a.timestamp)) / 1000
        const dTok = (b.output_tokens || 0)
        if (dt > 0 && dt < 120) ratePerSec = Math.min(80, dTok / dt)
      }
      const live = ageMs(s.file_mtime_ms, Date.now()) <= LIVE_WINDOW_MS
      next[s.session_id] = { base: total, at: Date.now(), ratePerSec: live ? ratePerSec : 0 }
    }
    baseRef.current = next
    force((n) => n + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, sessions.map((s) => `${s.session_id}:${s.file_mtime_ms}`).join('|')])

  const out: Record<string, number> = {}
  for (const s of sessions) {
    const b = baseRef.current[s.session_id]
    if (!b) {
      out[s.session_id] = s.input_tokens + s.output_tokens
      continue
    }
    const elapsedSec = Math.max(0, (now - b.at) / 1000)
    // Cap interpolation to one poll-window's worth so it can't drift wildly.
    const capped = Math.min(elapsedSec, 6)
    out[s.session_id] = Math.round(b.base + capped * b.ratePerSec)
  }
  return out
}

function TileSkeletons() {
  return (
    <StretchGrid count={6} min={270} maxCols={4} gap={6}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          style={{
            background: 'var(--v2-surface-2)',
            border: '1px solid var(--v2-border)',
            borderRadius: 'var(--v2-radius)',
            padding: 'var(--v2-s3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--v2-s2)',
          }}
        >
          <SkeletonRow height={16} width="60%" />
          <SkeletonRow height={28} />
          <SkeletonRow height={18} />
          <SkeletonRow height={13} width="80%" />
        </div>
      ))}
    </StretchGrid>
  )
}
