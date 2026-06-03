'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Sparkline — FLIGHTDECK §5. SVG, no axes/labels.
 *
 * Two forms:
 *   - variant="line" (default): 1.5px stroke polyline, optional area fill.
 *   - variant="bar": discrete cells (the 24-cell rail micro-sparkline form).
 *
 * Color tones (semantic, reserved):
 *   - "burn"  → linear gradient --v2-spark-from → --v2-spark-to (the ONLY
 *               sanctioned decorative gradient; reserved for burn-rate).
 *   - "token" → --v2-token   - "cost" → --v2-cost
 *   - "live"  → --v2-live     - "accent" → --v2-accent   - "neutral" → --v2-faint
 *
 * Optional `now` index draws a 1px vertical --v2-text tick at that data point.
 */
export type SparklineTone = 'burn' | 'token' | 'cost' | 'live' | 'accent' | 'neutral'
export type SparklineVariant = 'line' | 'bar'

const TONE_STROKE: Record<Exclude<SparklineTone, 'burn'>, string> = {
  token: 'var(--v2-token)',
  cost: 'var(--v2-cost)',
  live: 'var(--v2-live)',
  accent: 'var(--v2-accent)',
  neutral: 'var(--v2-faint)',
}

const TONE_FILL: Record<Exclude<SparklineTone, 'burn'>, string> = {
  token: 'var(--v2-token-weak)',
  cost: 'var(--v2-cost-weak)',
  live: 'var(--v2-live-weak)',
  accent: 'var(--v2-accent-weak)',
  neutral: 'var(--v2-border)',
}

// The burn gradient is identical for every sparkline instance (same stops, same
// orientation). Use a single stable, deterministic fragment id rather than
// React.useId(): useId only matches across SSR/CSR when the server and client
// walk the *same* tree in the *same* order, which is not guaranteed here —
// sparklines render inside client data-fetching subtrees (SWR / useLive) whose
// node counts diverge between the server render and first client render, so the
// useId counter drifts and produces a hydration mismatch on the gradient id.
// Since every burn gradient is byte-identical, sharing one id is correct: any
// number of identical <defs> resolve url(#id) to the same visual gradient.
const BURN_GRAD_ID = 'v2-spark-grad-burn'

export interface SparklineProps extends Omit<React.SVGProps<SVGSVGElement>, 'width' | 'height'> {
  data: number[]
  variant?: SparklineVariant
  tone?: SparklineTone
  width?: number
  height?: number
  /** Stroke width for line form. Default 1.5 (spec). */
  strokeWidth?: number
  /** Fill the area under a line sparkline with the weak tone. */
  area?: boolean
  /** Index of the current/now data point → draws a vertical tick. */
  now?: number
}

export function Sparkline({
  data,
  variant = 'line',
  tone = 'token',
  width = 96,
  height = 24,
  strokeWidth = 1.5,
  area = false,
  now,
  className,
  ...props
}: SparklineProps) {
  // Stable, SSR/CSR-identical gradient id (see BURN_GRAD_ID note above). Only
  // referenced when tone === 'burn'.
  const id = BURN_GRAD_ID

  const isBurn = tone === 'burn'
  const stroke = isBurn ? `url(#${id})` : TONE_STROKE[tone]
  const fill = isBurn ? `url(#${id})` : TONE_FILL[tone]

  const n = data.length
  const max = n ? Math.max(...data) : 0
  const min = n ? Math.min(...data) : 0
  const span = max - min || 1

  // Map a value to a y in [pad, height-pad] (inverted: high value = top).
  const pad = strokeWidth
  const yOf = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2)

  if (variant === 'bar') {
    const gap = 1
    const cellW = n ? Math.max(1, (width - gap * (n - 1)) / n) : width
    return (
      <svg
        data-slot="v2-sparkline"
        className={cn('block', className)}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        {...props}
      >
        {isBurn && (
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--v2-spark-from)" />
              <stop offset="100%" stopColor="var(--v2-spark-to)" />
            </linearGradient>
          </defs>
        )}
        {data.map((v, i) => {
          const h = max ? Math.max(1, (v / max) * (height - pad)) : 1
          return (
            <rect
              key={i}
              x={i * (cellW + gap)}
              y={height - h}
              width={cellW}
              height={h}
              rx={0.5}
              fill={isBurn ? `url(#${id})` : TONE_STROKE[tone]}
              opacity={now != null && i > now ? 0.35 : 1}
            />
          )
        })}
      </svg>
    )
  }

  // Line form.
  const stepX = n > 1 ? width / (n - 1) : width
  const points = data.map((v, i) => `${i * stepX},${yOf(v)}`)
  const linePath = points.length ? `M${points.join(' L')}` : ''
  const areaPath = points.length
    ? `M0,${height} L${points.join(' L')} L${(n - 1) * stepX},${height} Z`
    : ''

  return (
    <svg
      data-slot="v2-sparkline"
      className={cn('block', className)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      {...props}
    >
      {isBurn && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--v2-spark-from)" />
            <stop offset="100%" stopColor="var(--v2-spark-to)" />
          </linearGradient>
        </defs>
      )}
      {area && areaPath && <path d={areaPath} fill={fill} stroke="none" opacity={0.5} />}
      {linePath && (
        <path
          d={linePath}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {now != null && n > 1 && (
        <line
          x1={now * stepX}
          y1={0}
          x2={now * stepX}
          y2={height}
          stroke="var(--v2-text)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          opacity={0.7}
        />
      )}
    </svg>
  )
}
