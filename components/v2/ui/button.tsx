'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import { cn } from '@/lib/utils'
import { Kbd } from './kbd'

/**
 * Button — FLIGHTDECK §5.
 *   variant: primary | ghost | outline
 *   size:    sm (28px) | md (32px) | icon-sm | icon-md
 * Focus ring: 2px --v2-accent, offset 2px. Optional inline mono `kbd` hint.
 *
 * Hover/focus state colors live in a scoped stylesheet injected once at module
 * load (V2_BUTTON_CSS), so `asChild` (radix Slot) still receives a single child.
 */
const buttonVariants = cva(
  'v2-btn inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium select-none ' +
    'transition-colors disabled:pointer-events-none disabled:opacity-50 ' +
    'outline-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'v2-btn--primary',
        ghost: 'v2-btn--ghost',
        outline: 'v2-btn--outline',
      },
      size: {
        sm: 'h-7 px-2.5 [&_svg:not([class*=size-])]:size-3.5',
        md: 'h-8 px-3 [&_svg:not([class*=size-])]:size-4',
        'icon-sm': 'h-7 w-7 [&_svg:not([class*=size-])]:size-3.5',
        'icon-md': 'h-8 w-8 [&_svg:not([class*=size-])]:size-4',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  }
)

const V2_BUTTON_CSS = `
.v2-btn:focus-visible { box-shadow: 0 0 0 2px var(--v2-bg), 0 0 0 4px var(--v2-accent); }
.v2-btn--primary { background: var(--v2-accent); color: var(--v2-accent-fg); }
.v2-btn--primary:hover { filter: brightness(1.06); }
.v2-btn--ghost { background: transparent; color: var(--v2-muted); }
.v2-btn--ghost:hover { background: var(--v2-surface-2); color: var(--v2-text); }
.v2-btn--outline { background: transparent; color: var(--v2-text); border: 1px solid var(--v2-border); }
.v2-btn--outline:hover { background: var(--v2-surface-2); border-color: var(--v2-border-2); }
`

let injected = false
function useButtonStyles() {
  React.useEffect(() => {
    if (injected || typeof document === 'undefined') return
    if (document.getElementById('v2-button-styles')) {
      injected = true
      return
    }
    const el = document.createElement('style')
    el.id = 'v2-button-styles'
    el.textContent = V2_BUTTON_CSS
    document.head.appendChild(el)
    injected = true
  }, [])
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** Trailing inline keyboard hint, e.g. "⌘K" or "↵". */
  kbd?: React.ReactNode
}

export function Button({
  className,
  variant = 'ghost',
  size = 'md',
  asChild = false,
  kbd,
  children,
  ...props
}: ButtonProps) {
  useButtonStyles()
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="v2-button"
      data-variant={variant}
      className={cn(buttonVariants({ variant, size }), className)}
      style={{
        fontFamily: 'var(--v2-font-sans)',
        fontSize: 'var(--v2-text-body)',
        borderRadius: 'var(--v2-radius-sm)',
        transitionDuration: 'var(--v2-dur)',
        transitionTimingFunction: 'var(--v2-ease)',
      }}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {children}
          {kbd != null && (
            <Kbd className="ml-0.5" style={{ background: 'transparent', border: 'none' }}>
              {kbd}
            </Kbd>
          )}
        </>
      )}
    </Comp>
  )
}

export { buttonVariants }
