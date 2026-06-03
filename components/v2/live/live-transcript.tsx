'use client'

import * as React from 'react'
import { Cpu } from 'lucide-react'
import type { RecentTurn } from './live-types'
import { fmtAge, ageMs } from './live-types'

/* ═══════════════════════════════════════════════════════════════════════════
   LiveTranscript — a live log of what Claude is SAYING in a session: its recent
   assistant text turns. Tool calls are intentionally NOT shown (owner: "I don't
   want to see the tool calls it made") — only the prose.

   The data is `recent_turns` from /api/sessions/active (chronological, oldest →
   newest), refreshed by the parent's poll. We render newest at the BOTTOM (like
   a terminal tail) and auto-scroll to the bottom when new turns arrive, so the
   latest message is always in view. `depth` caps how many text turns we show —
   the solo layout shows more, the pair layout fewer.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface LiveTranscriptProps {
  turns: RecentTurn[]
  /** Max turns to render (most recent N). */
  depth: number
  /** Wall-clock now (ms) for relative timestamps. */
  now: number
  /** True while the session is live — drives the trailing pulse. */
  live: boolean
}

function turnKey(t: RecentTurn, i: number): string {
  return `${t.timestamp || i}-${i}`
}

export function LiveTranscript({ turns, depth, now, live }: LiveTranscriptProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // Only turns that have TEXT (skip pure tool-call turns), most recent `depth`,
  // oldest → newest (tail order). Tool calls are deliberately not surfaced.
  const shown = React.useMemo(() => {
    const textTurns = (turns ?? []).filter((t) => (t.text ?? '').trim())
    return textTurns.slice(Math.max(0, textTurns.length - depth))
  }, [turns, depth])

  // Auto-scroll to the bottom whenever the turn set changes (new activity).
  const sig = shown.map((t) => t.timestamp).join('|')
  React.useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [sig])

  if (shown.length === 0) {
    return (
      <div
        className="v2-mono flex items-center justify-center"
        style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-faint)', minHeight: 60 }}
      >
        no messages yet — waiting for activity…
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="flex flex-col gap-[var(--v2-s2)]"
      style={{ overflowY: 'auto', minHeight: 0, flex: 1 }}
    >
      {shown.map((t, i) => {
        const last = i === shown.length - 1
        return (
          <div key={turnKey(t, i)} className="flex items-start gap-[var(--v2-s2)] min-w-0">
            {/* Left rail: subtle marker, accented + pulsing on the latest message */}
            <span
              aria-hidden
              className="shrink-0"
              style={{
                width: 5,
                height: 5,
                borderRadius: 999,
                marginTop: 7,
                background: last && live ? 'var(--v2-live)' : 'var(--v2-border)',
              }}
            />
            <span
              className="flex-1 min-w-0"
              style={{
                fontSize: 'var(--v2-text-micro)',
                lineHeight: 1.45,
                color: last ? 'var(--v2-text)' : 'var(--v2-muted)',
                display: '-webkit-box',
                WebkitLineClamp: last ? 6 : 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {t.text}
            </span>
            {/* Right gutter: per-turn output tokens + relative time */}
            <div className="shrink-0 flex flex-col items-end gap-0.5">
              {t.output_tokens > 0 && (
                <span
                  className="v2-mono inline-flex items-center gap-1"
                  style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}
                  title={`${t.output_tokens} output tokens`}
                >
                  <Cpu size={9} />
                  {t.output_tokens >= 1000 ? `${(t.output_tokens / 1000).toFixed(1)}k` : t.output_tokens}
                </span>
              )}
              <span
                className="v2-mono"
                style={{ fontSize: 'var(--v2-text-label)', color: last && live ? 'var(--v2-live)' : 'var(--v2-faint)' }}
                title={t.timestamp}
              >
                {t.timestamp ? fmtAge(ageMs(Date.parse(t.timestamp), now)) : ''}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
