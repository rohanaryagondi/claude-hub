'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * SearchInput — FLIGHTDECK §5. The RECALL front door (NOT a modal).
 * Full-width, --v2-surface-2 bg, 1px --v2-border (focus → --v2-border-2 + 2px
 * --v2-accent ring). Leading `/` glyph in --v2-faint. Mono input text.
 * Trailing live readout (e.g. `12ms · 412 docs`) in --v2-faint.
 *
 * Controlled (`value`/`onValueChange`) or uncontrolled (`defaultValue`).
 * Exposes a ref to the underlying <input> so `/` can focus it from anywhere.
 */
export interface SearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'size'> {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  /** Trailing live readout, e.g. "12ms · 412 docs". Mono, faint. */
  readout?: React.ReactNode
  /** Override the leading glyph (default "/"). */
  glyph?: React.ReactNode
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, defaultValue, onValueChange, readout, glyph = '/', className, style, onChange, placeholder, ...props },
  ref
) {
  const [focused, setFocused] = React.useState(false)

  return (
    <div
      data-slot="v2-search-input"
      data-focused={focused}
      className={cn('flex w-full items-center gap-2', className)}
      style={{
        background: 'var(--v2-surface-2)',
        border: `1px solid ${focused ? 'var(--v2-border-2)' : 'var(--v2-border)'}`,
        borderRadius: 'var(--v2-radius)',
        boxShadow: focused ? '0 0 0 2px var(--v2-accent-weak)' : undefined,
        padding: '0 var(--v2-s3)',
        height: 36,
        transition: 'border-color var(--v2-dur) var(--v2-ease), box-shadow var(--v2-dur) var(--v2-ease)',
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          fontFamily: 'var(--v2-font-mono)',
          fontSize: 'var(--v2-text-body)',
          color: 'var(--v2-faint)',
          userSelect: 'none',
        }}
      >
        {glyph}
      </span>
      <input
        ref={ref}
        type="text"
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        defaultValue={defaultValue}
        onChange={(e) => {
          onChange?.(e)
          onValueChange?.(e.target.value)
        }}
        onFocus={(e) => {
          setFocused(true)
          props.onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          props.onBlur?.(e)
        }}
        className="min-w-0 flex-1 bg-transparent outline-none v2-search-field"
        style={{
          fontFamily: 'var(--v2-font-mono)',
          fontSize: 'var(--v2-text-body)',
          color: 'var(--v2-text)',
        }}
        {...props}
      />
      {readout != null && (
        <span
          className="shrink-0 whitespace-nowrap"
          style={{
            fontFamily: 'var(--v2-font-mono)',
            fontSize: 'var(--v2-text-micro)',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--v2-faint)',
          }}
        >
          {readout}
        </span>
      )}
      <style>{`.v2-search-field::placeholder{color:var(--v2-faint);opacity:1}`}</style>
    </div>
  )
})
