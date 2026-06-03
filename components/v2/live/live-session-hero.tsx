'use client'

import * as React from 'react'
import { Cpu, Sparkles, Maximize2, SplitSquareHorizontal } from 'lucide-react'
import { projectColor } from '@/lib/project-color'
import { sessionTitle } from '@/lib/session-title'
import { StatusDot } from '@/components/v2/ui'
import { useCatchup, deterministicSummary, AwaitingChip } from './catchup'
import { LiveTranscript } from './live-transcript'
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
  LIVE_WINDOW_MS,
} from './live-types'

/* ═══════════════════════════════════════════════════════════════════════════
   LiveSessionHero — the PRIMARY view of one running session on the cockpit.

   The cockpit picks a layout by how many sessions are live: one → a single
   full-bleed hero (variant "solo", deep transcript); two → side-by-side heroes
   (variant "pair", shorter transcript). It leads with what Claude is SAYING —
   the catch-up narrative + the live "doing now" line + a live transcript of
   recent turns — then a ticking instrument footer.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface LiveSessionHeroProps {
  session: ActiveSessionFull
  now: number
  tickTokens?: number
  variant: 'solo' | 'pair'
  onOpen?: (id: string) => void
  onSplit?: (id: string) => void
}

export function LiveSessionHero({ session, now, tickTokens, variant, onOpen, onSplit }: LiveSessionHeroProps) {
  const name = folderName(session.project_path)
  const tail = pathTail(session.project_path, 1)
  const hue = projectColor(name)
  const title = sessionTitle({ first_prompt: session.first_prompt, session_id: session.session_id })

  const delta = ageMs(session.file_mtime_ms, now)
  const isLive = delta <= LIVE_WINDOW_MS

  const catchup = useCatchup(session.session_id, session.file_mtime_ms)
  const aiSummary = (catchup?.summary ?? '').trim()
  const heroNarrative = aiSummary || (catchup ? deterministicSummary(catchup) : 'reading recent activity…')

  const totalTok = tickTokens != null ? tickTokens : session.input_tokens + session.output_tokens
  const ratePerMin = recentTokenRate(session.recent_turns, now)

  const depth = variant === 'solo' ? 12 : 6

  return (
    <section
      className="relative flex flex-col overflow-hidden"
      data-live={isLive}
      style={{
        background: 'var(--v2-surface-2)',
        border: `1px solid ${isLive ? 'var(--v2-live)' : 'var(--v2-border)'}`,
        borderRadius: 'var(--v2-radius)',
        // Solo sizes to its content (transcript) with a modest floor + a
        // generous cap, so a sparse session isn't padded with blank space and a
        // busy one fills up to the cap then scrolls. Pair keeps a fixed floor so
        // the two heroes read as an even pair.
        minHeight: variant === 'solo' ? 260 : 360,
        maxHeight: variant === 'solo' ? 'min(72vh, 760px)' : undefined,
        height: undefined,
      }}
    >
      {/* live wash + project spine */}
      <span aria-hidden style={{ position: 'absolute', inset: 0, background: isLive ? 'var(--v2-live-weak)' : 'transparent', pointerEvents: 'none' }} />
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: hue }} />

      {/* ── Header ── */}
      <div
        className="relative flex items-center gap-[var(--v2-s2)] shrink-0"
        style={{ padding: 'var(--v2-s3) var(--v2-s4)', borderBottom: '1px solid var(--v2-border)' }}
      >
        <StatusDot state={isLive ? 'live' : 'recent'} size={9} className="self-center" />
        <div className="flex flex-col min-w-0 flex-1">
          <span className="truncate" style={{ fontSize: 'var(--v2-text-sm-head)', fontWeight: 600, color: 'var(--v2-text)' }} title={title}>
            {title}
          </span>
          <span className="v2-mono truncate" style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-muted)' }} title={session.project_path}>
            {name}{tail ? <span style={{ color: 'var(--v2-faint)' }}> {tail}</span> : null}
          </span>
        </div>
        <AwaitingChip data={catchup} />
        <span
          className="v2-mono shrink-0"
          style={{ fontSize: 'var(--v2-text-micro)', color: isLive ? 'var(--v2-live)' : 'var(--v2-faint)' }}
          title={`last activity ${fmtAge(delta)} ago`}
        >
          {fmtAge(delta)}
        </span>
        <button
          type="button"
          onClick={() => onOpen?.(session.session_id)}
          className="shrink-0 inline-flex items-center justify-center transition-colors"
          style={{ width: 24, height: 24, borderRadius: 'var(--v2-radius-sm)', color: 'var(--v2-faint)', background: 'var(--v2-surface-3)' }}
          title="Open full replay"
        >
          <Maximize2 size={12} />
        </button>
        {variant === 'solo' && (
          <button
            type="button"
            onClick={() => onSplit?.(session.session_id)}
            className="shrink-0 inline-flex items-center justify-center transition-colors"
            style={{ width: 24, height: 24, borderRadius: 'var(--v2-radius-sm)', color: 'var(--v2-faint)', background: 'var(--v2-surface-3)' }}
            title="Open split view"
          >
            <SplitSquareHorizontal size={12} />
          </button>
        )}
      </div>

      {/* ── Catch-up narrative — what Claude has been doing ── */}
      <div className="relative shrink-0" style={{ padding: 'var(--v2-s3) var(--v2-s4) 0' }}>
        <p
          className="flex items-start"
          style={{
            fontSize: variant === 'solo' ? 'var(--v2-text-body)' : 'var(--v2-text-micro)',
            lineHeight: 1.5, margin: 0,
            color: aiSummary ? 'var(--v2-text)' : 'var(--v2-muted)',
            display: '-webkit-box',
            WebkitLineClamp: variant === 'solo' ? 4 : 3,
            WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}
          title={heroNarrative}
        >
          <Sparkles size={13} style={{ display: 'inline', flexShrink: 0, marginRight: 6, marginTop: 3, color: 'var(--v2-ai)' }} />
          <span>{heroNarrative}</span>
        </p>
      </div>

      {/* ── Live transcript (what Claude is SAYING — text only, no tool calls) ── */}
      <div
        className="relative flex flex-col min-h-0 flex-1"
        style={{ padding: '0 var(--v2-s4) var(--v2-s2)', borderTop: '1px solid var(--v2-border)', marginTop: 'var(--v2-s2)', paddingTop: 'var(--v2-s2)' }}
      >
        <span className="v2-label shrink-0" style={{ marginBottom: 'var(--v2-s1)', color: 'var(--v2-faint)' }}>
          TRANSCRIPT
        </span>
        <LiveTranscript turns={session.recent_turns} depth={depth} now={now} live={isLive} />
      </div>

      {/* ── Instrument footer ── */}
      <div
        className="relative flex items-center gap-[var(--v2-s3)] v2-mono shrink-0"
        style={{ padding: 'var(--v2-s2) var(--v2-s4)', borderTop: '1px solid var(--v2-border)', fontSize: 'var(--v2-text-micro)' }}
      >
        <span className="inline-flex items-center gap-1" style={{ color: 'var(--v2-token)' }} title="total tokens this session">
          <Cpu size={11} />{fmtTokens(totalTok)}
        </span>
        {isLive && ratePerMin > 0 && (
          <span style={{ color: 'var(--v2-token)', opacity: 0.7 }} title="token rate">{fmtTokens(Math.round(ratePerMin))}/m</span>
        )}
        <span style={{ color: 'var(--v2-cost)' }} title="estimated cost">{fmtCost(session.estimated_cost)}</span>
        <span style={{ color: 'var(--v2-faint)' }} title="messages">{session.assistant_message_count} turns</span>
        <span className="ml-auto" style={{ color: 'var(--v2-faint)' }} title="active elapsed">{fmtDuration(session.duration_minutes)}</span>
      </div>
    </section>
  )
}
