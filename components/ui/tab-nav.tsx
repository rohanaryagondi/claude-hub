'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'

export function useActiveTab(paramName = 'tab', defaultValue: string): string {
  const searchParams = useSearchParams()
  return searchParams.get(paramName) ?? defaultValue
}

export function TabNav({
  tabs,
  paramName = 'tab',
  defaultValue,
  className,
}: {
  tabs: { label: string; value: string }[]
  paramName?: string
  defaultValue: string
  className?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const active = searchParams.get(paramName) ?? defaultValue

  function select(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set(paramName, value)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <div className={cn('flex items-center gap-4 border-b border-border', className)}>
      {tabs.map(tab => {
        const isActive = tab.value === active
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => select(tab.value)}
            className={cn(
              'relative -mb-px py-2 text-sm font-medium whitespace-nowrap transition-colors',
              isActive
                ? 'text-foreground border-b-2 border-foreground'
                : 'text-muted-foreground border-b-2 border-transparent hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
