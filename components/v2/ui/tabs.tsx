'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * Tabs (TabNav) — FLIGHTDECK §5.
 * Horizontal in-canopy sub-view switcher (NOT top-level mode nav — that's the
 * gutter). Idle: --v2-faint label. Active: --v2-text + 2px --v2-accent underline.
 *
 * Two modes, same API:
 *   - URL mode (default): syncs to a search param via `paramName`; shareable.
 *   - Controlled mode: pass `value` + `onValueChange` to drive from state.
 *
 * `useActiveTab(paramName, default)` reads the current URL tab for callers.
 */
export interface TabItem {
  label: React.ReactNode
  value: string
}

export interface TabsProps {
  tabs: TabItem[]
  /** Default/initial tab value. */
  defaultValue: string
  /** URL search param to sync to (URL mode). Default "tab". */
  paramName?: string
  /** Controlled value (controlled mode — disables URL sync). */
  value?: string
  onValueChange?: (value: string) => void
  className?: string
}

export function useActiveTab(paramName = 'tab', defaultValue = ''): string {
  const searchParams = useSearchParams()
  return searchParams.get(paramName) ?? defaultValue
}

export function Tabs({
  tabs,
  defaultValue,
  paramName = 'tab',
  value,
  onValueChange,
  className,
}: TabsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const controlled = value !== undefined

  const active = controlled ? value! : searchParams.get(paramName) ?? defaultValue

  function select(next: string) {
    onValueChange?.(next)
    if (controlled) return
    const params = new URLSearchParams(searchParams.toString())
    params.set(paramName, next)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <div
      data-slot="v2-tabs"
      role="tablist"
      className={cn('flex items-center gap-4', className)}
      style={{ borderBottom: '1px solid var(--v2-border)' }}
    >
      {tabs.map((tab) => {
        const isActive = tab.value === active
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-active={isActive}
            onClick={() => select(tab.value)}
            className={cn(
              'relative -mb-px whitespace-nowrap transition-colors v2-tab',
              className
            )}
            style={{
              padding: '8px 0',
              fontFamily: 'var(--v2-font-sans)',
              fontSize: 'var(--v2-text-body)',
              fontWeight: 500,
              color: isActive ? 'var(--v2-text)' : 'var(--v2-faint)',
              borderBottom: `2px solid ${isActive ? 'var(--v2-accent)' : 'transparent'}`,
              transitionDuration: 'var(--v2-dur)',
              transitionTimingFunction: 'var(--v2-ease)',
            }}
          >
            {tab.label}
          </button>
        )
      })}
      <style>{`.v2-tab[data-active="false"]:hover{color:var(--v2-text)}`}</style>
    </div>
  )
}

// Backwards-friendly alias matching the existing legacy export name.
export { Tabs as TabNav }
