'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   CommandPalette — the ⌘K quick-switcher the status bar has always advertised.

   Mounted once by V2Shell. Cmd/Ctrl+K toggles it; typing filters the nav
   destinations (label + hint + keywords), Enter routes. Themed by the shadcn
   popover tokens, which follow the `.dark` class on <html>, so it matches the
   active deck theme even though radix portals it to <body>.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Radio, Search, History, FolderGit2, Gauge, NotebookPen } from 'lucide-react'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'

/** Destinations mirror the gutter NAV. `keywords` widen what the filter matches,
 *  so typing "search"/"ask"/"cost" still lands on the right row. */
const DESTINATIONS = [
  { label: 'Command Deck', href: '/', icon: Radio, hint: 'live cockpit', keywords: 'home live cockpit deck now running' },
  { label: 'Recall', href: '/ask', icon: Search, hint: 'ask Claude over your history', keywords: 'ask chat question recall claude answer' },
  { label: 'Sessions', href: '/sessions', icon: History, hint: 'search & replay', keywords: 'search find replay transcript history list' },
  { label: 'Projects', href: '/projects', icon: FolderGit2, hint: 'per-project workspaces', keywords: 'project workspace repo folder' },
  { label: 'Instruments', href: '/stats', icon: Gauge, hint: 'usage · cost · model mix', keywords: 'stats usage cost tokens charts metrics spend' },
  { label: 'Desk', href: '/desk', icon: NotebookPen, hint: 'notes · prompts · memory', keywords: 'notes prompts memory desk rebuild scratch' },
]

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const go = React.useCallback(
    (href: string) => {
      setOpen(false)
      router.push(href)
    },
    [router],
  )

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Jump to…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Go to">
          {DESTINATIONS.map((d) => {
            const Icon = d.icon
            return (
              <CommandItem
                key={d.href}
                value={`${d.label} ${d.hint} ${d.keywords}`}
                onSelect={() => go(d.href)}
              >
                <Icon className="h-4 w-4 opacity-70" />
                <span>{d.label}</span>
                <span className="ml-auto text-xs text-muted-foreground/60">{d.hint}</span>
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
