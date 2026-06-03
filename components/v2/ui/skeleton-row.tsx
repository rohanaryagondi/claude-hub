'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * SkeletonRow — FLIGHTDECK §3/§5. Replaces ALL spinners.
 * A --v2-surface-2 block with a calm 1.2s opacity shimmer (no spin).
 *
 * `<SkeletonRow />` is a single bar; `<SkeletonRow.List count={n} />` stacks
 * dense (30px) loading rows for lists/tables.
 */
export interface SkeletonRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Height in px. Default 30 (dense row). */
  height?: number
  /** Width as a CSS length or %. Default "100%". */
  width?: string | number
}

export function SkeletonRow({ height = 30, width = '100%', className, style, ...props }: SkeletonRowProps) {
  return (
    <div
      data-slot="v2-skeleton-row"
      aria-hidden
      className={cn('v2-anim-shimmer', className)}
      style={{
        height,
        width,
        background: 'var(--v2-surface-2)',
        borderRadius: 'var(--v2-radius-sm)',
        ...style,
      }}
      {...props}
    />
  )
}

export interface SkeletonListProps extends React.HTMLAttributes<HTMLDivElement> {
  count?: number
  rowHeight?: number
  gap?: number
}

function SkeletonList({ count = 6, rowHeight = 30, gap = 8, className, style, ...props }: SkeletonListProps) {
  return (
    <div
      data-slot="v2-skeleton-list"
      aria-hidden
      className={cn('flex flex-col', className)}
      style={{ gap, ...style }}
      {...props}
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} height={rowHeight} style={{ opacity: 1 - i * 0.06 }} />
      ))}
    </div>
  )
}

SkeletonRow.List = SkeletonList
