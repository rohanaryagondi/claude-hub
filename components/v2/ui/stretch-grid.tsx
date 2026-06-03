'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   StretchGrid — a responsive grid that fills the row.

   The problem it fixes: `repeat(auto-fill, minmax(MIN, 1fr))` materialises
   *phantom* empty tracks to pad the row, so e.g. 3 cards on a wide canopy stay
   pinned at MIN width with dead columns to the right. StretchGrid measures the
   container and renders exactly `cols` equal tracks, where

     cols = clamp(1, min(maxCols, count, floor(width / MIN)))

   → never more columns than items (no phantoms), never narrower than `min`,
   never more than `maxCols`, and items always divide the full width evenly.

   Before the first measurement it falls back to `auto-fit` (which, unlike
   `auto-fill`, collapses empty tracks) so SSR / first paint is already correct.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as React from 'react'

export interface StretchGridProps {
  /** Item count — caps the column count so phantom empty tracks never appear. */
  count: number
  /** Minimum comfortable item width, in px. */
  min: number
  /** Hard cap on column count (e.g. 4 for the live band). Omit for unbounded. */
  maxCols?: number
  /** Gap between items, in px. Maps to the spacing scale: 6=s2, 10=s3, 14=s4. */
  gap?: number
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}

export function StretchGrid({
  count,
  min,
  maxCols,
  gap = 6,
  className,
  style,
  children,
}: StretchGridProps) {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = React.useState<number | null>(null)

  React.useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const gridTemplateColumns = React.useMemo(() => {
    if (width == null) {
      // Pre-measurement fallback: auto-fit collapses empty tracks (unlike auto-fill).
      return `repeat(auto-fit, minmax(${min}px, 1fr))`
    }
    const fit = Math.floor((width + gap) / (min + gap))
    let cols = Math.max(1, Math.min(count || 1, fit))
    if (maxCols) cols = Math.min(cols, maxCols)
    return `repeat(${Math.max(1, cols)}, minmax(0, 1fr))`
  }, [width, min, gap, count, maxCols])

  return (
    <div
      ref={ref}
      className={className}
      style={{ display: 'grid', gridTemplateColumns, gap: `${gap}px`, ...style }}
    >
      {children}
    </div>
  )
}
