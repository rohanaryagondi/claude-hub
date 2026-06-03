import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Kbd — FLIGHTDECK §5. Inline keyboard hint.
 * --v2-surface-3 bg, --v2-border hairline, --v2-radius-sm, mono 11px, --v2-faint.
 * Pure presentational; no client hooks → safe in server components too.
 */
export type KbdProps = React.HTMLAttributes<HTMLElement>

export function Kbd({ className, style, children, ...props }: KbdProps) {
  return (
    <kbd
      data-slot="v2-kbd"
      className={cn('inline-flex items-center justify-center', className)}
      style={{
        minWidth: 16,
        height: 16,
        padding: '0 4px',
        background: 'var(--v2-surface-3)',
        border: '1px solid var(--v2-border)',
        borderRadius: 'var(--v2-radius-sm)',
        fontFamily: 'var(--v2-font-mono)',
        fontSize: 'var(--v2-text-label)',
        lineHeight: 1,
        color: 'var(--v2-faint)',
        ...style,
      }}
      {...props}
    >
      {children}
    </kbd>
  )
}
