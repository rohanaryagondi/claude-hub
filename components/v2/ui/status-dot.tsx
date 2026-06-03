'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * StatusDot — FLIGHTDECK §5.
 * An 8px semantic state dot. A glowing green dot must always be true:
 *   - `live`   → --v2-live, with a 2s expanding heartbeat ring
 *   - `recent` → --v2-recent (amber, static): touched recently / idle-warming
 *   - `idle`   → --v2-faint (static): idle / done
 *
 * Size is configurable but defaults to the spec's 8px.
 */
export type StatusDotState = 'live' | 'recent' | 'idle'

const STATE_COLOR: Record<StatusDotState, string> = {
  live: 'var(--v2-live)',
  recent: 'var(--v2-recent)',
  idle: 'var(--v2-faint)',
}

export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  state?: StatusDotState
  /** Diameter in px. Default 8 (spec). */
  size?: number
  /** Force the heartbeat ring on/off. Defaults to true only for `live`. */
  pulse?: boolean
}

export function StatusDot({
  state = 'idle',
  size = 8,
  pulse,
  className,
  style,
  ...props
}: StatusDotProps) {
  const color = STATE_COLOR[state]
  const showPulse = pulse ?? state === 'live'

  return (
    <span
      data-slot="v2-status-dot"
      data-state={state}
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: size, height: size, ...style }}
      aria-hidden
      {...props}
    >
      {showPulse && (
        <span
          className="v2-anim-pulse-ring absolute inset-0 rounded-full"
          style={{ background: color }}
        />
      )}
      <span
        className="relative inline-block rounded-full"
        style={{ width: size, height: size, background: color }}
      />
    </span>
  )
}
