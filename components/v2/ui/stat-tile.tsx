'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Sparkline, type SparklineProps } from './sparkline'

/**
 * StatTile — FLIGHTDECK §5.
 * Vertical readout: UPPERCASE label, hero mono tabular value, optional delta
 * chip (▲/▼ + %, green=up/live, red=down/cost) and an optional inline sparkline.
 *
 * Background is transparent by default (so a cluster reads as one Panel on
 * INSTRUMENTS); pass `standalone` for the --v2-surface-2 tile background.
 *
 * `tone` colors the hero value for semantic readouts (cost=red, token=blue,
 * live=green); default leaves it as primary --v2-text.
 */
export type StatTileTone = 'default' | 'cost' | 'token' | 'live' | 'recent' | 'accent'

const TONE_COLOR: Record<StatTileTone, string> = {
  default: 'var(--v2-text)',
  cost: 'var(--v2-cost)',
  token: 'var(--v2-token)',
  live: 'var(--v2-live)',
  recent: 'var(--v2-recent)',
  accent: 'var(--v2-accent)',
}

export interface StatTileDelta {
  /** Signed percentage or absolute change. Sign drives the arrow + color. */
  value: number
  /** Override the displayed text (e.g. "+12%"); defaults to `±value%`. */
  label?: string
  /** Invert color meaning (e.g. a cost increase is "bad"/red). Default: up=good. */
  invert?: boolean
}

export interface StatTileProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  label: React.ReactNode
  value: React.ReactNode
  /** Smaller secondary line under the value (mono micro, muted). */
  sub?: React.ReactNode
  /** Hero value size: 'hero' (22px, default) or 'lead' (30px, INSTRUMENTS). */
  size?: 'hero' | 'lead'
  tone?: StatTileTone
  delta?: StatTileDelta
  /** Inline sparkline rendered beneath the value. */
  spark?: number[]
  sparkProps?: Partial<Omit<SparklineProps, 'data'>>
  /** Use the surface-2 tile background instead of transparent. */
  standalone?: boolean
}

function DeltaChip({ value, label, invert }: StatTileDelta) {
  if (value === 0) {
    return (
      <span
        className="inline-flex items-center gap-0.5"
        style={{
          fontFamily: 'var(--v2-font-mono)',
          fontSize: 'var(--v2-text-micro)',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--v2-faint)',
        }}
      >
        ◦ {label ?? '0%'}
      </span>
    )
  }
  const up = value > 0
  const good = invert ? !up : up
  const color = good ? 'var(--v2-live)' : 'var(--v2-cost)'
  const arrow = up ? '▲' : '▼'
  const text = label ?? `${up ? '+' : ''}${value}%`
  return (
    <span
      className="inline-flex items-center gap-0.5"
      style={{
        fontFamily: 'var(--v2-font-mono)',
        fontSize: 'var(--v2-text-micro)',
        fontVariantNumeric: 'tabular-nums',
        color,
      }}
    >
      <span aria-hidden>{arrow}</span>
      {text}
    </span>
  )
}

export function StatTile({
  label,
  value,
  sub,
  size = 'hero',
  tone = 'default',
  delta,
  spark,
  sparkProps,
  standalone = false,
  className,
  style,
  ...props
}: StatTileProps) {
  return (
    <div
      data-slot="v2-stat-tile"
      className={cn('flex flex-col gap-1', className)}
      style={{
        background: standalone ? 'var(--v2-surface-2)' : 'transparent',
        border: standalone ? '1px solid var(--v2-border)' : undefined,
        borderRadius: standalone ? 'var(--v2-radius)' : undefined,
        padding: standalone ? 'var(--v2-s3)' : undefined,
        ...style,
      }}
      {...props}
    >
      <span
        className="uppercase"
        style={{
          fontFamily: 'var(--v2-font-sans)',
          fontSize: 'var(--v2-text-label)',
          fontWeight: 600,
          letterSpacing: '0.08em',
          lineHeight: 1.2,
          color: 'var(--v2-faint)',
        }}
      >
        {label}
      </span>

      <div className="flex items-baseline gap-2">
        <span
          style={{
            fontFamily: 'var(--v2-font-mono)',
            fontSize: size === 'lead' ? 'var(--v2-text-hero-lg)' : 'var(--v2-text-hero)',
            fontWeight: 600,
            lineHeight: 1.05,
            fontVariantNumeric: 'tabular-nums',
            color: TONE_COLOR[tone],
          }}
        >
          {value}
        </span>
        {delta && <DeltaChip {...delta} />}
      </div>

      {sub != null && (
        <span
          style={{
            fontFamily: 'var(--v2-font-mono)',
            fontSize: 'var(--v2-text-micro)',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--v2-muted)',
          }}
        >
          {sub}
        </span>
      )}

      {spark && spark.length > 0 && (
        <Sparkline
          data={spark}
          width={sparkProps?.width ?? 120}
          height={sparkProps?.height ?? 22}
          tone={sparkProps?.tone ?? (tone === 'cost' ? 'cost' : tone === 'token' ? 'token' : 'accent')}
          {...sparkProps}
          className={cn('mt-0.5', sparkProps?.className)}
        />
      )}
    </div>
  )
}
