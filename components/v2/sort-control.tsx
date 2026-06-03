'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   SortControl — a segmented sort control (the TabNav idiom, §5).

   The active option carries the 2px accent underline; idle options are faint.
   Shared by /sessions and /projects so the two surfaces sort identically.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as React from 'react'

export interface SortControlOption<K extends string> {
  key: K
  label: string
}

export function SortControl<K extends string>({
  options,
  value,
  onChange,
  label = 'sort',
  ariaLabel,
}: {
  options: SortControlOption<K>[]
  value: K
  onChange: (k: K) => void
  /** Leading label (hidden on narrow). Pass '' to omit. */
  label?: string
  ariaLabel?: string
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-[var(--v2-s1)]"
      role="tablist"
      aria-label={ariaLabel ?? label ?? 'sort'}
    >
      {label && (
        <span className="v2-label mr-[var(--v2-s2)] hidden sm:inline" style={{ color: 'var(--v2-faint)' }}>
          {label}
        </span>
      )}
      {options.map((opt) => {
        const active = opt.key === value
        return (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.key)}
            className="relative v2-mono transition-colors"
            style={{
              padding: '5px 8px',
              fontSize: 'var(--v2-text-micro)',
              color: active ? 'var(--v2-text)' : 'var(--v2-faint)',
              background: 'transparent',
              transitionDuration: 'var(--v2-dur)',
              transitionTimingFunction: 'var(--v2-ease)',
            }}
          >
            {opt.label}
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: 6,
                right: 6,
                bottom: 0,
                height: 2,
                borderRadius: 'var(--v2-radius-pill)',
                background: 'var(--v2-accent)',
                opacity: active ? 1 : 0,
                transition: 'opacity var(--v2-dur) var(--v2-ease)',
              }}
            />
          </button>
        )
      })}
    </div>
  )
}
