import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Section — FLIGHTDECK §4 canopy header pattern + §3 divider.
 *
 * Renders the standard screen header: an UPPERCASE tracked eyebrow (mode name),
 * a --v2-text-sm-head title, a one-line mono "dek" of scope context, an optional
 * right-aligned action slot, then a hairline rule.
 *
 * Use <SectionDivider /> for a bare hairline elsewhere. Presentational only.
 */
export interface SectionProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  /** UPPERCASE eyebrow, e.g. "RECALL". */
  eyebrow?: React.ReactNode
  title?: React.ReactNode
  /** Mono scope dek, e.g. "412 sessions · 27 projects · since Mar". */
  dek?: React.ReactNode
  /** Right-aligned actions (buttons, scope chip, sort control). */
  actions?: React.ReactNode
  /** Drop the bottom hairline rule. */
  noRule?: boolean
}

export function Section({
  eyebrow,
  title,
  dek,
  actions,
  noRule = false,
  className,
  style,
  children,
  ...props
}: SectionProps) {
  return (
    <header
      data-slot="v2-section"
      className={cn('flex items-end justify-between gap-4', className)}
      style={{
        paddingBottom: 'var(--v2-s3)',
        borderBottom: noRule ? undefined : '1px solid var(--v2-border)',
        ...style,
      }}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow != null && (
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
            {eyebrow}
          </span>
        )}
        {title != null && (
          <h1
            className="truncate"
            style={{
              fontFamily: 'var(--v2-font-sans)',
              fontSize: 'var(--v2-text-sm-head)',
              fontWeight: 500,
              lineHeight: 1.35,
              color: 'var(--v2-text)',
            }}
          >
            {title}
          </h1>
        )}
        {dek != null && (
          <span
            className="truncate"
            style={{
              fontFamily: 'var(--v2-font-mono)',
              fontSize: 'var(--v2-text-micro)',
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--v2-muted)',
            }}
          >
            {dek}
          </span>
        )}
        {children}
      </div>
      {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

export interface SectionDividerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Vertical (column) divider instead of horizontal. */
  vertical?: boolean
}

export function SectionDivider({ vertical = false, className, style, ...props }: SectionDividerProps) {
  return (
    <div
      data-slot="v2-section-divider"
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      className={cn(vertical ? 'self-stretch' : 'w-full', className)}
      style={
        vertical
          ? { width: 1, background: 'var(--v2-border)', ...style }
          : { height: 1, background: 'var(--v2-border)', ...style }
      }
      {...props}
    />
  )
}

/** SectionLabel — a bare UPPERCASE tracked --v2-faint label (no rule). */
export function SectionLabel({ className, style, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-slot="v2-section-label"
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
