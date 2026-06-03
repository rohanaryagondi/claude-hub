'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Panel — FLIGHTDECK §5, the structural workhorse.
 * --v2-surface, 1px --v2-border, --v2-radius, padding --v2-s4 (≈14px). No shadow.
 *
 * Density: the panel sizes to its CONTENT — it carries no default min-height
 * and the body does not flex-grow by default. Callers that want a panel to
 * fill a grid track can pass `fill` (or `flex-1` via className).
 *
 * Optional header slot renders the canonical pattern:
 *   --v2-text-label eyebrow + --v2-text-sm-head title + hairline rule.
 * Use <Panel.Header> / <Panel.Body> for full control, or the `title`/`eyebrow`
 * convenience props for the common case.
 */

export interface PanelProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Convenience header title (sans, 15px/500). Renders the standard header. */
  title?: React.ReactNode
  /** Convenience UPPERCASE tracked eyebrow above the title. */
  eyebrow?: React.ReactNode
  /** Right-aligned content in the convenience header (actions, scope chip). */
  headerRight?: React.ReactNode
  /** Drop the inner padding (e.g. when the body is a flush list/table). */
  flush?: boolean
  /** Let the panel + its body grow to fill the parent track (opt-in). */
  fill?: boolean
}

export function Panel({
  title,
  eyebrow,
  headerRight,
  flush = false,
  fill = false,
  className,
  style,
  children,
  ...props
}: PanelProps) {
  const hasConvenienceHeader = title != null || eyebrow != null || headerRight != null

  return (
    <div
      data-slot="v2-panel"
      // No min-height: panels size to content by default. `fill` opts into
      // growing within a grid/flex track.
      className={cn('flex flex-col overflow-hidden', fill && 'h-full', className)}
      style={{
        background: 'var(--v2-surface)',
        border: '1px solid var(--v2-border)',
        borderRadius: 'var(--v2-radius)',
        ...style,
      }}
      {...props}
    >
      {hasConvenienceHeader && (
        <PanelHeader right={headerRight}>
          {eyebrow != null && <PanelEyebrow>{eyebrow}</PanelEyebrow>}
          {title != null && <PanelTitle>{title}</PanelTitle>}
        </PanelHeader>
      )}
      <div
        className={cn('min-h-0', fill && 'flex-1')}
        style={{ padding: flush ? 0 : 'var(--v2-s4)' }}
      >
        {children}
      </div>
    </div>
  )
}

export interface PanelHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  right?: React.ReactNode
}

export function PanelHeader({ right, className, children, style, ...props }: PanelHeaderProps) {
  return (
    <div
      data-slot="v2-panel-header"
      className={cn('flex items-start justify-between gap-3', className)}
      style={{
        padding: 'var(--v2-s3) var(--v2-s4)',
        borderBottom: '1px solid var(--v2-border)',
        ...style,
      }}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-0.5">{children}</div>
      {right != null && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  )
}

export function PanelEyebrow({ className, style, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="v2-panel-eyebrow"
      className={cn('uppercase', className)}
      style={{
        fontFamily: 'var(--v2-font-sans)',
        fontSize: 'var(--v2-text-label)',
        fontWeight: 600,
        letterSpacing: '0.08em',
        lineHeight: 1.2,
        color: 'var(--v2-faint)',
        ...style,
      }}
      {...props}
    />
  )
}

export function PanelTitle({ className, style, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      data-slot="v2-panel-title"
      className={cn('truncate', className)}
      style={{
        fontFamily: 'var(--v2-font-sans)',
        fontSize: 'var(--v2-text-sm-head)',
        fontWeight: 500,
        lineHeight: 1.35,
        color: 'var(--v2-text)',
        ...style,
      }}
      {...props}
    />
  )
}

export function PanelBody({ className, style, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="v2-panel-body"
      // Sizes to content by default; add `flex-1` via className to fill a track.
      className={cn('min-h-0', className)}
      style={{ padding: 'var(--v2-s4)', ...style }}
      {...props}
    />
  )
}

Panel.Header = PanelHeader
Panel.Eyebrow = PanelEyebrow
Panel.Title = PanelTitle
Panel.Body = PanelBody
