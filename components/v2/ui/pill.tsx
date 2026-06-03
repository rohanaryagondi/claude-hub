'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { StatusDot, type StatusDotState } from './status-dot'

/**
 * Pill — FLIGHTDECK §5.
 * --v2-radius-pill, --v2-surface-2 bg, --v2-border hairline, mono micro text.
 * Optional leading StatusDot. Variants tint border + text by meaning:
 *   - live   → green   - recent → amber
 *   - accent → terracotta (active selection)   - neutral → slate (default)
 */
const pillVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap align-middle',
  {
    variants: {
      variant: {
        neutral: '',
        live: '',
        recent: '',
        accent: '',
      },
    },
    defaultVariants: { variant: 'neutral' },
  }
)

type PillVariant = NonNullable<VariantProps<typeof pillVariants>['variant']>

const VARIANT_STYLE: Record<PillVariant, React.CSSProperties> = {
  neutral: { color: 'var(--v2-muted)', borderColor: 'var(--v2-border)' },
  live: { color: 'var(--v2-live)', borderColor: 'var(--v2-live-weak)' },
  recent: { color: 'var(--v2-recent)', borderColor: 'var(--v2-recent)' },
  accent: { color: 'var(--v2-accent)', borderColor: 'var(--v2-accent-weak)' },
}

const VARIANT_DOT: Partial<Record<PillVariant, StatusDotState>> = {
  live: 'live',
  recent: 'recent',
}

export interface PillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pillVariants> {
  /** Show a leading StatusDot. `true` infers state from variant; pass a state to override. */
  dot?: boolean | StatusDotState
}

export function Pill({ variant = 'neutral', dot, className, style, children, ...props }: PillProps) {
  const v = (variant ?? 'neutral') as PillVariant
  const dotState: StatusDotState | undefined =
    dot === true ? VARIANT_DOT[v] ?? 'idle' : dot === false || dot == null ? undefined : dot

  return (
    <span
      data-slot="v2-pill"
      data-variant={v}
      className={cn(pillVariants({ variant }), className)}
      style={{
        background: 'var(--v2-surface-2)',
        border: '1px solid',
        borderRadius: 'var(--v2-radius-pill)',
        padding: '2px 8px',
        fontFamily: 'var(--v2-font-mono)',
        fontSize: 'var(--v2-text-micro)',
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.2,
        ...VARIANT_STYLE[v],
        ...style,
      }}
      {...props}
    >
      {dotState && <StatusDot state={dotState} size={6} />}
      {children}
    </span>
  )
}
