'use client'

import * as React from 'react'

/**
 * ActivityStrip — FLIGHTDECK §5.
 * A 60-cell horizontal micro-bar (newest at the right). Cell height encodes
 * activity; active beats glow --v2-live and fade to --v2-faint toward the past.
 * Pure SVG, no axes. Used on live tiles.
 */
export interface ActivityStripProps {
  data: number[]
  width?: number
  height?: number
  /** Green-tinted (live) vs neutral (idle/finished). */
  live?: boolean
  className?: string
}

export function ActivityStrip({
  data,
  width = 280,
  height = 22,
  live = true,
  className,
}: ActivityStripProps) {
  const n = data.length || 1
  const max = Math.max(1, ...data)
  const gap = 1
  const cellW = Math.max(1, (width - gap * (n - 1)) / n)
  const color = live ? 'var(--v2-live)' : 'var(--v2-faint)'

  return (
    <svg
      className={className}
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="recent activity"
      style={{ display: 'block' }}
    >
      {data.map((v, i) => {
        const h = v > 0 ? Math.max(2, (v / max) * (height - 1)) : 1
        // Fade older cells (left) toward faint; emphasize the recent tail.
        const recency = i / Math.max(1, n - 1) // 0 oldest → 1 newest
        const opacity = v > 0 ? 0.35 + recency * 0.65 : 0.18
        return (
          <rect
            key={i}
            x={i * (cellW + gap)}
            y={height - h}
            width={cellW}
            height={h}
            rx={0.5}
            fill={v > 0 ? color : 'var(--v2-border)'}
            opacity={opacity}
          />
        )
      })}
    </svg>
  )
}
