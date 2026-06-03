'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   FLIGHTDECK — RECALL citation chips.

   Owner feedback: kill the 12-card, 3-col citation grid. Cite chats as COMPACT
   LINKS instead. This file owns:

   • <CitationChips> — a tight "Sources" strip rendered UNDER an answer: up to
     ~5 numbered chips, each "[n] <sessionTitle> · <project> · <date>", each a
     next/link to that session in-app (/sessions/<session_id>). Clicking a
     chip navigates to the session's detail/replay elsewhere in the app. One or
     two tight rows — never a wall.

   The session NAME is always derived via sessionTitle() (the foundation's
   helper) — never a raw hex id or the project folder alone.

   Reads ONLY --v2-* tokens.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as React from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { projectColor } from '@/lib/project-color'
import { sessionTitleShort } from '@/lib/session-title'
import type { SearchResult } from '@/lib/search-index'

/** In-app destination for a cited session (its detail/replay view). */
export function sessionHref(r: SearchResult): string {
  return `/sessions/${r.session_id}`
}

/** Human session NAME for a search hit. The search API now computes `title`
 *  server-side (slug → first-prompt → short id); prefer it (already prettified —
 *  just truncate). Fall back to the slug derivation for older payloads. */
export function citationTitle(r: SearchResult, n = 34): string {
  const t = r.title?.trim()
  if (t) return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t
  return sessionTitleShort({ slug_name: r.session_slug, session_id: r.session_id }, n)
}

function dateLabel(date: string): string {
  if (!date) return ''
  try {
    return format(new Date(date), 'MMM d')
  } catch {
    return ''
  }
}

/* ─────────────────────────── ONE SOURCE CHIP ──────────────────────────── */
const Chip = React.forwardRef<
  HTMLAnchorElement,
  { n: number; result: SearchResult }
>(function Chip({ n, result }, ref) {
  const title = citationTitle(result)
  const date = dateLabel(result.date)

  return (
    <Link
      ref={ref}
      href={sessionHref(result)}
      className="group inline-flex max-w-full items-center gap-1.5 transition-colors v2-cite-chip"
      style={{
        padding: '3px var(--v2-s2) 3px 3px',
        borderRadius: 'var(--v2-radius-pill)',
        background: 'var(--v2-surface-2)',
        border: '1px solid var(--v2-border)',
        minWidth: 0,
      }}
      title={`${title} — ${result.project_name}${date ? ` · ${date}` : ''}`}
    >
      <span
        className="v2-mono flex shrink-0 items-center justify-center"
        style={{
          width: 16,
          height: 16,
          borderRadius: 'var(--v2-radius-pill)',
          background: 'var(--v2-surface-3)',
          color: 'var(--v2-ai)',
          fontSize: 'var(--v2-text-label)',
          fontWeight: 600,
        }}
      >
        {n}
      </span>
      <span
        aria-hidden
        className="shrink-0"
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: projectColor(result.project_name),
        }}
      />
      <span
        className="truncate"
        style={{
          fontFamily: 'var(--v2-font-sans)',
          fontSize: 'var(--v2-text-micro)',
          fontWeight: 500,
          color: 'var(--v2-text)',
          lineHeight: 1.3,
        }}
      >
        {title}
      </span>
      <span
        className="v2-mono hidden shrink-0 sm:inline"
        style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}
      >
        · {result.project_name}
        {date ? ` · ${date}` : ''}
      </span>
      <style>{`.v2-cite-chip:hover{border-color:var(--v2-border-2);background:var(--v2-surface-3)}`}</style>
    </Link>
  )
})

/* ─────────────────────────── SOURCES STRIP ────────────────────────────── */
export interface CitationChipsProps {
  /** Retrieved sessions for this turn (already ranked). */
  sources: SearchResult[]
  /** Label override — "MATCHES" when search-only, else "SOURCES". */
  label?: string
  /** Cap the number of chips (default 5). */
  max?: number
  /**
   * Optional: hand back the per-chip anchor elements so the answer's inline
   * [n] markers can scroll/focus the matching chip.
   */
  refs?: React.MutableRefObject<(HTMLAnchorElement | null)[]>
}

export function CitationChips({
  sources,
  label = 'SOURCES',
  max = 5,
  refs,
}: CitationChipsProps) {
  const shown = sources.slice(0, max)
  if (shown.length === 0) return null

  return (
    <div style={{ marginTop: 'var(--v2-s3)' }}>
      <div
        className="v2-label"
        style={{ color: 'var(--v2-faint)', marginBottom: 'var(--v2-s2)' }}
      >
        {label}
      </div>
      <div className="flex flex-wrap items-center" style={{ gap: 'var(--v2-s2)' }}>
        {shown.map((r, i) => (
          <Chip
            key={r.session_id}
            n={i + 1}
            result={r}
            ref={(el) => {
              if (refs) refs.current[i] = el
            }}
          />
        ))}
      </div>
    </div>
  )
}
