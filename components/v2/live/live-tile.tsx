'use client'

import * as React from 'react'
import { Cpu, Sparkles } from 'lucide-react'
import { projectColor } from '@/lib/project-color'
import { sessionTitle } from '@/lib/session-title'
import { StatusDot, type StatusDotState } from '@/components/v2/ui'
import { ActivityStrip } from './activity-strip'
import { useCatchup, deterministicSummary, AwaitingChip } from './catchup'
import {
  type ActiveSessionFull,
  folderName,
  pathTail,
  fmtTokens,
  fmtCost,
  fmtAge,
  fmtDuration,
  ageMs,
  recentTokenRate,
  activityStrip,
  LIVE_WINDOW_MS,
} from './live-types'

/**
 * LiveTile — FLIGHTDECK §6 "Live Shore" instrument tile.
 *
 * Owner feedback (cards redesign): the PRIMARY content is what Claude says —
 * the catch-up summary of what happened since the owner's last message. The
 * tile leads with it; the "waiting on you" chip sits up on the project line
 * (most actionable signal first); the live "now" line compresses to one line;
 * the activity strip + token/cost/duration stats merge into one micro footer.
 *
 * States: active (live border + wash, green dot heartbeat) → recent (amber) →
 * idle (slate, dimmed) past the live window.
 */
export interface LiveTileProps {
  session: ActiveSessionFull
  now: number
  /** Per-second ticking token estimate, supplied by the parent's interpolator. */
  tickTokens?: number
  onOpen?: (sessionId: string) => void
  onSplit?: (sessionId: string) => void
  selected?: boolean
}

export function LiveTile({ session, now, tickTokens, onOpen, onSplit, selected }: LiveTileProps) {
  const name = folderName(session.project_path)
  const tail = pathTail(session.project_path, 1)
  const hue = projectColor(name)
  // Owner feedback #3: show the human session NAME, not just the folder.
  const title = sessionTitle({
    custom_title: session.custom_title,
    first_prompt: session.first_prompt,
    session_id: session.session_id,
  })
  const delta = ageMs(session.file_mtime_ms, now)
  const isLive = delta <= LIVE_WINDOW_MS
  const isRecent = !isLive && delta <= 60 * 60 * 1000

  const dotState: StatusDotState = isLive ? 'live' : isRecent ? 'recent' : 'idle'
  const strip = activityStrip(session.recent_turns)

  // ── HERO content: the catch-up summary (what Claude did since the owner's
  //    last message). Fallback ladder: AI summary → deterministic counts line →
  //    Claude's latest message TEXT (never tool calls). ───────────────────────
  const catchup = useCatchup(session.session_id, session.file_mtime_ms)
  const aiSummary = (catchup?.summary ?? '').trim()
  const heroIsAi = aiSummary.length > 0
  const latestText = React.useMemo(() => {
    const turns = session.recent_turns ?? []
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = (turns[i].text ?? '').trim()
      if (t) return t
    }
    return ''
  }, [session.recent_turns])
  const heroText = heroIsAi
    ? aiSummary
    : catchup
      ? deterministicSummary(catchup)
      : latestText || 'reading recent activity…'

  const totalTok =
    tickTokens != null ? tickTokens : session.input_tokens + session.output_tokens

  // Per-session token rate over a bounded RECENT window (not a full session/day).
  const ratePerMin = recentTokenRate(session.recent_turns, now)

  // Tile chrome reacts to liveness.
  const borderColor = isLive ? 'var(--v2-live)' : 'var(--v2-border)'
  const wash = isLive ? 'var(--v2-live-weak)' : 'transparent'

  return (
    <button
      type="button"
      onClick={() => onOpen?.(session.session_id)}
      onKeyDown={(e) => {
        if (e.key === 'o') {
          e.preventDefault()
          onSplit?.(session.session_id)
        }
      }}
      data-live={isLive}
      className="group/tile relative flex flex-col gap-[var(--v2-s2)] text-left transition-colors"
      style={{
        background: 'var(--v2-surface-2)',
        border: `1px solid ${selected ? 'var(--v2-accent)' : borderColor}`,
        borderRadius: 'var(--v2-radius)',
        padding: 'var(--v2-s3) var(--v2-s3) var(--v2-s3) var(--v2-s4)',
        opacity: isLive ? 1 : 0.78,
        transitionDuration: 'var(--v2-dur)',
        transitionTimingFunction: 'var(--v2-ease)',
        overflow: 'hidden',
      }}
    >
      {/* Live wash overlay (very subtle) */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: wash,
          pointerEvents: 'none',
        }}
      />
      {/* ProjectSpine — 3px identity ribbon on the left edge */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: hue,
        }}
      />

      {/* Header row: dot + human session NAME + age */}
      <div className="relative flex items-baseline gap-[var(--v2-s2)]">
        <StatusDot state={dotState} className="self-center" />
        <span
          className="truncate"
          style={{
            fontSize: 'var(--v2-text-body)',
            fontWeight: 600,
            color: 'var(--v2-text)',
            minWidth: 0,
            flex: 1,
          }}
          title={title}
        >
          {title}
        </span>
        <span
          className="v2-mono ml-auto shrink-0"
          style={{
            fontSize: 'var(--v2-text-micro)',
            color: isLive ? 'var(--v2-live)' : 'var(--v2-faint)',
          }}
          title={`last activity ${fmtAge(delta)} ago`}
        >
          {fmtAge(delta)}
        </span>
      </div>

      {/* Project context line: folder + dim parent tail + the most actionable
          signal — the waiting-on-you chip — promoted up here */}
      <div className="relative flex items-center gap-[var(--v2-s2)] -mt-[var(--v2-s1)]">
        <span
          className="v2-mono truncate shrink-0"
          style={{
            fontSize: 'var(--v2-text-label)',
            color: 'var(--v2-muted)',
            maxWidth: '50%',
          }}
          title={session.project_path}
        >
          {name}
        </span>
        {tail && (
          <span
            className="v2-mono truncate"
            style={{
              fontSize: 'var(--v2-text-label)',
              color: 'var(--v2-faint)',
              minWidth: 0,
            }}
            title={session.project_path}
          >
            {tail}
          </span>
        )}
        <span className="ml-auto shrink-0 inline-flex">
          <AwaitingChip data={catchup} />
        </span>
      </div>

      {/* HERO — the catch-up: what Claude did since the owner's last message.
          This is the tile's primary content (owner: "the important info is what
          claude is saying"). */}
      <div className="relative flex flex-col gap-1 min-w-0">
        <p
          style={{
            fontSize: 'var(--v2-text-body)',
            lineHeight: 1.45,
            color: heroIsAi ? 'var(--v2-text)' : 'var(--v2-muted)',
            margin: 0,
            display: '-webkit-box',
            WebkitLineClamp: 7,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
          title={heroText}
        >
          {heroIsAi && (
            <Sparkles
              size={11}
              style={{
                display: 'inline',
                verticalAlign: 'baseline',
                marginRight: 5,
                color: 'var(--v2-ai)',
              }}
            />
          )}
          {heroText}
        </p>
        {/* Concrete counts stay as a dim meta line under the AI summary */}
        {heroIsAi && catchup && catchup.since_count > 0 && (
          <span
            className="v2-mono truncate"
            style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-faint)' }}
            title={deterministicSummary(catchup)}
          >
            {deterministicSummary(catchup)}
          </span>
        )}
      </div>

      {/* Footer — activity strip + instruments merged into ONE micro row:
          strip · tokens · rate · cost · elapsed (demoted, not primary) */}
      <div
        className="relative flex items-center gap-[var(--v2-s3)] v2-mono"
        style={{ fontSize: 'var(--v2-text-micro)' }}
      >
        <span className="flex-1 min-w-0" style={{ maxWidth: '38%' }}>
          <ActivityStrip data={strip} live={isLive} height={12} />
        </span>
        <span
          className="inline-flex items-center gap-1 shrink-0"
          style={{ color: 'var(--v2-token)' }}
          title={`${totalTok.toLocaleString()} tokens (input + output)`}
        >
          <Cpu size={11} />
          {fmtTokens(totalTok)}
        </span>
        {isLive && ratePerMin > 0 && (
          <span className="shrink-0" style={{ color: 'var(--v2-token)', opacity: 0.7 }} title="token rate">
            {fmtTokens(Math.round(ratePerMin))}/m
          </span>
        )}
        <span className="shrink-0" style={{ color: 'var(--v2-cost)' }} title={`$${session.estimated_cost.toFixed(4)} estimated`}>
          {fmtCost(session.estimated_cost)}
        </span>
        <span className="ml-auto shrink-0" style={{ color: 'var(--v2-faint)' }} title="active elapsed">
          {fmtDuration(session.duration_minutes)}
        </span>
      </div>
    </button>
  )
}
